// v96 — bcryptjs (pure-JS port) intentionally chosen over the native
// `bcrypt` package. The dependency audit flags bcryptjs as
// "maintenance mode" (no new releases since 2023), but the bcrypt
// **algorithm** is unchanged — what's "frozen" is feature work, not
// security patches. The pure-JS implementation:
//   * works identically on Node 22 / 24, no node-gyp + python needed
//   * adds no native binary to the Vercel serverless bundle (every
//     /api/auth/anonymous cold-start would pay the dlopen cost
//     otherwise)
//   * runs ~30× slower than native bcrypt at the same cost factor,
//     which is negligible at this app's scale (a few logins / second
//     even during a launch spike)
// If the project later migrates to a higher-throughput auth path,
// switching to `bcrypt` is hash-format compatible ($2a/$2b/$2y), so
// existing user passwords keep verifying without a re-hash cycle.
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { signAccessToken, signRefreshToken, verifySession, signMfaPendingToken, verifyMfaPendingToken } from "../lib/jwt.js";
import { env } from "../env.js";
import { HttpError } from "../middleware/error.js";

function mintTokens(user: { id: string; email: string; tokenVersion: number }) {
  const payload = { uid: user.id, email: user.email, ver: user.tokenVersion };
  return {
    token: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  };
}

export async function register(email: string, password: string, displayName?: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new HttpError(409, "email_taken");

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { email, passwordHash, displayName },
    select: { id: true, email: true, displayName: true, tokenVersion: true },
  });
  return { user: { id: user.id, email: user.email, displayName: user.displayName }, ...mintTokens(user) };
}

// v92 — account lockout (DISA STIG AC-7). Locks the account for
// LOCKOUT_DURATION_MS after MAX_FAILED_ATTEMPTS unsuccessful logins.
// Resets on first success. Returns 423 LOCKED while in the cooldown
// window. Prevents distributed dictionary attacks that the per-IP
// rate limit can't catch.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new HttpError(401, "invalid_credentials");
  if (user.permanentlyBanned) throw new HttpError(403, "banned");
  // v96 — soft-deleted accounts present as "invalid_credentials" so
  // we don't leak the deletion state to an attacker. The recovery
  // path lives in the account-settings UI behind a confirmation flow.
  if (user.deletedAt) throw new HttpError(401, "invalid_credentials");

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minsRemaining = Math.ceil((+user.lockedUntil - Date.now()) / 60_000);
    throw new HttpError(
      423,
      "account_locked",
      `Account locked after repeated failed logins. Try again in ${minsRemaining} minute${minsRemaining === 1 ? "" : "s"}.`,
    );
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const fails = user.failedAttempts + 1;
    const shouldLock = fails >= MAX_FAILED_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: fails,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
      },
    });
    throw new HttpError(401, "invalid_credentials");
  }

  // Successful login — reset lockout counters.
  if (user.failedAttempts > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });
  }

  // v93p3 — if MFA is enabled the password was only the first factor.
  // Return a short-lived "mfa_pending" challenge token instead of the
  // real access/refresh pair. Client then POSTs to /auth/mfa/verify
  // with the TOTP code to receive the full token pair.
  if (user.mfaEnabled) {
    return {
      mfaRequired: true,
      // v96 — was `pendingUserId: user.id` (raw). A distributed
      // brute-force could enumerate TOTP codes against arbitrary user
      // ids since authLimiter is per-IP. Now a JWT (5min ttl, typ
      // pinned to "mfa_pending") so only ids that actually completed
      // password-auth in the last 5 minutes are challengeable.
      mfaPendingToken: signMfaPendingToken(user.id),
      user: { id: user.id, email: user.email, displayName: user.displayName },
    } as const;
  }

  return {
    user: { id: user.id, email: user.email, displayName: user.displayName },
    ...mintTokens(user),
  };
}

// v93p3 — second-factor verification step. Called after login()
// returns mfaRequired:true. Verifies the TOTP code against the
// stored secret and returns the real access+refresh token pair.
// v96 — accepts the signed mfaPendingToken returned by login()
// instead of a raw user id so an attacker cannot challenge a userId
// they didn't legitimately receive from a prior password-auth.
export async function verifyMfaAndIssueTokens(mfaPendingToken: string, code: string) {
  let uid: string;
  try {
    ({ uid } = verifyMfaPendingToken(mfaPendingToken));
  } catch {
    throw new HttpError(401, "invalid_mfa_pending_token");
  }
  const { verifyMfaCode, consumeMfaCode } = await import("./mfa.service.js");
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { id: true, email: true, displayName: true, tokenVersion: true, mfaEnabled: true, mfaSecret: true, permanentlyBanned: true },
  });
  if (!user || user.permanentlyBanned) throw new HttpError(401, "invalid_credentials");
  if (!user.mfaEnabled || !user.mfaSecret) throw new HttpError(400, "mfa_not_enabled");
  if (!verifyMfaCode(user.mfaSecret, code)) throw new HttpError(401, "mfa_invalid_code");
  // fix(audit mfa-totp-replay): RFC 6238 §5.2 single-use — reject a replayed
  // valid code (same generic error so replay is indistinguishable from a wrong
  // code). Best-effort via Redis; see consumeMfaCode.
  if (!(await consumeMfaCode(user.id, code))) throw new HttpError(401, "mfa_invalid_code");
  return {
    user: { id: user.id, email: user.email, displayName: user.displayName },
    ...mintTokens(user),
  };
}

// v93p2 — refresh a short-TTL access token using a long-TTL refresh
// token. The refresh token itself isn't rotated here (rotation could
// be added later); on password change / logout the user's tokenVersion
// increments and the next refresh attempt fails with token_revoked.
export async function refreshAccessToken(refreshToken: string) {
  const payload = verifySession(refreshToken, { expectType: "refresh" });
  const user = await prisma.user.findUnique({
    where: { id: payload.uid },
    select: { id: true, email: true, tokenVersion: true, permanentlyBanned: true },
  });
  if (!user || user.permanentlyBanned) throw new HttpError(401, "invalid_token");
  if ((payload.ver ?? 0) < user.tokenVersion) throw new HttpError(401, "token_revoked");
  return { token: signAccessToken({ uid: user.id, email: user.email, ver: user.tokenVersion }) };
}

// v93p2 — increment tokenVersion to revoke all existing tokens for the
// user (logout, password change, "sign out everywhere"). The client
// should drop its locally-stored tokens after calling this.
// v96 — also flush the in-process tokenVersion cache so the just-
// revoked access token stops authenticating immediately on this
// node instead of riding the documented 30 s TTL.
export async function logout(userId: string): Promise<void> {
  const { invalidateTokenVersionCache } = await import("../middleware/auth.js");
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
  invalidateTokenVersionCache(userId);
}

export async function me(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      suspendedUntil: true,
      permanentlyBanned: true,
      alertPreference: true,
    },
  });
}

// v96 — soft-delete the user's own account. Obfuscates email so the
// row no longer occupies the user's real address (frees them to
// re-register later if they want) and bumps tokenVersion so every
// active token is rejected on next request. The retention worker
// hard-deletes any row whose deletedAt is past the grace window.
export async function softDeleteAccount(userId: string): Promise<void> {
  const { invalidateTokenVersionCache } = await import("../middleware/auth.js");
  const obfuscatedEmail = `deleted-${userId}-${Date.now().toString(36)}@deleted.travelsafe.local`;
  await prisma.user.update({
    where: { id: userId },
    data: {
      deletedAt: new Date(),
      email: obfuscatedEmail,
      displayName: null,
      tokenVersion: { increment: 1 },
    },
  });
  // v96 — same rationale as logout(): drop the cache entry so the
  // just-revoked token can't ride the 30s TTL.
  invalidateTokenVersionCache(userId);
}
