import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { signAccessToken, signRefreshToken, verifySession } from "../lib/jwt.js";
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
export async function logout(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
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
