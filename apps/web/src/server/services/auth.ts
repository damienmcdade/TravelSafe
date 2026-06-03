import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { signSession, signMfaPendingToken, verifyMfaPendingToken } from "../lib/jwt";
import { env } from "../lib/env";
import { HttpError } from "../lib/http";

// fix(audit pentest-authn-6): password reset. requestPasswordReset emails a
// single-use, 1-hour link; resetPassword consumes it. The token is random;
// only its SHA-256 hash is stored, so a DB leak can't be used to reset accounts.
function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function requestPasswordReset(email: string): Promise<void> {
  const normEmail = normalizeEmail(email);
  const user = await prisma.user.findUnique({
    where: { email: normEmail },
    select: { id: true, email: true, deletedAt: true },
  });
  // No account enumeration: behave identically whether or not the email exists.
  if (!user || user.deletedAt) return;
  const token = crypto.randomBytes(32).toString("base64url");
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetTokenHash: hashResetToken(token),
      passwordResetExpiry: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    },
  });
  const base = (env.LIVE_SHARE_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  const url = `${base}/reset-password?token=${token}`;
  const { sendEmail } = await import("./notifications/email");
  await sendEmail(
    user.email,
    "CommunitySafe — reset your password",
    `Someone requested a password reset for your CommunitySafe account.\n\n` +
      `Reset it here (valid for 1 hour, single use): ${url}\n\n` +
      `If you didn't request this, ignore this email — your password is unchanged.`,
  );
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  if (!token || newPassword.length < 12) {
    throw new HttpError(400, "password_too_short", "Password must be at least 12 characters.");
  }
  const user = await prisma.user.findFirst({
    where: { passwordResetTokenHash: hashResetToken(token) },
    select: { id: true, passwordResetExpiry: true },
  });
  if (!user || !user.passwordResetExpiry || user.passwordResetExpiry < new Date()) {
    throw new HttpError(400, "invalid_or_expired_token", "This reset link is invalid or has expired.");
  }
  const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      tokenVersion: { increment: 1 }, // revoke every existing session
      passwordResetTokenHash: null,
      passwordResetExpiry: null,
      // Resetting the password also clears any brute-force lockout (so the lockout
      // can't be weaponized into account-DoS — pentest-authn-6).
      failedAttempts: 0,
      lockedUntil: null,
    },
  });
  const { invalidateSessionRevocation } = await import("../lib/auth");
  invalidateSessionRevocation(user.id);
}

// Postgres treats `User.email @unique` as case-sensitive by default,
// so `bob@x.com` and `Bob@x.com` would both be insertable as
// distinct accounts. Schema-review finding #7 — fix at the service
// layer by normalizing every email touch to lowercase. Trimming
// whitespace is the safe-by-default companion (form inputs commonly
// have leading/trailing spaces from paste).
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function register(email: string, password: string, displayName?: string) {
  const normEmail = normalizeEmail(email);
  const existing = await prisma.user.findUnique({ where: { email: normEmail } });
  if (existing) throw new HttpError(409, "email_taken");

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { email: normEmail, passwordHash, displayName },
    select: { id: true, email: true, displayName: true, tokenVersion: true },
  });
  return {
    user: { id: user.id, email: user.email, displayName: user.displayName },
    token: signSession({ uid: user.id, email: user.email, ver: user.tokenVersion }),
  };
}

// v106 (security audit) — account lockout (DISA STIG / NIST 800-53 AC-7).
// The Express auth service already enforced this, but the Vercel web login()
// — the primary surface — did NOT, so a brute-force via /api/auth/login
// bypassed the lockout the User model was built for (failedAttempts/lockedUntil
// already exist). Unlike the per-IP edge rate limiter (per-instance memory, so
// a distributed attacker can spread across instances), the lockout is in
// Postgres and catches distributed dictionary attacks.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export async function login(email: string, password: string) {
  const normEmail = normalizeEmail(email);
  const user = await prisma.user.findUnique({ where: { email: normEmail } });
  if (!user) throw new HttpError(401, "invalid_credentials");
  if (user.permanentlyBanned) throw new HttpError(403, "banned");
  // Soft-deleted accounts present as invalid_credentials (parity w/ Express —
  // don't leak deletion state to an attacker).
  if (user.deletedAt) throw new HttpError(401, "invalid_credentials");

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((+user.lockedUntil - Date.now()) / 60_000);
    throw new HttpError(
      423,
      "account_locked",
      `Account locked after repeated failed logins. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
    );
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const fails = user.failedAttempts + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: fails,
        lockedUntil: fails >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
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

  // fix(audit pentest-authn-1 — CRITICAL): if MFA is enabled the password was
  // only the FIRST factor. Previously the web login issued a full session token
  // here regardless, silently ignoring the user's second factor — a password
  // compromise meant full account takeover despite enrolled MFA. Now we withhold
  // the session token and return a short-lived mfa_pending ticket; the client
  // must exchange it + a valid TOTP code at /api/auth/mfa/verify. Mirrors the
  // Express auth.service.ts behaviour so the two stacks can't drift.
  if (user.mfaEnabled) {
    return {
      mfaRequired: true,
      mfaPendingToken: signMfaPendingToken(user.id),
      user: { id: user.id, email: user.email, displayName: user.displayName },
    } as const;
  }

  return {
    user: { id: user.id, email: user.email, displayName: user.displayName },
    token: signSession({ uid: user.id, email: user.email, ver: user.tokenVersion }),
  };
}

// fix(audit pentest-authn-1 + pentest-authn-3): second-factor verification.
// Called after login() returns mfaRequired:true. Verifies the TOTP code against
// the stored secret and, only then, issues the real session token. The same
// per-account failed-attempt lockout that guards password login is applied here
// so the TOTP step can't be brute-forced via distributed IPs (the per-IP edge
// limiter alone doesn't catch that).
export async function verifyMfaAndIssueTokens(mfaPendingToken: string, code: string) {
  let uid: string;
  try {
    ({ uid } = verifyMfaPendingToken(mfaPendingToken));
  } catch {
    throw new HttpError(401, "invalid_mfa_pending_token");
  }

  const user = await prisma.user.findUnique({ where: { id: uid } });
  if (!user || user.permanentlyBanned || user.deletedAt) throw new HttpError(401, "invalid_credentials");
  if (!user.mfaEnabled || !user.mfaSecret) throw new HttpError(400, "mfa_not_enabled");

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((+user.lockedUntil - Date.now()) / 60_000);
    throw new HttpError(
      423,
      "account_locked",
      `Account locked after repeated failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
    );
  }

  const { verifyMfaCode } = await import("./mfa.service");
  if (!verifyMfaCode(user.mfaSecret, code)) {
    const fails = user.failedAttempts + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: fails,
        lockedUntil: fails >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
      },
    });
    throw new HttpError(401, "mfa_invalid_code");
  }

  if (user.failedAttempts > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null },
    });
  }

  return {
    user: { id: user.id, email: user.email, displayName: user.displayName },
    token: signSession({ uid: user.id, email: user.email, ver: user.tokenVersion }),
  };
}

// fix(audit auth-no-revocation-web-2): revoke every existing token for the user
// by bumping tokenVersion (logout / sign-out-everywhere / password change). The
// client should drop its stored token after calling this; any token still in
// flight fails requireSession's ver check on its next request.
export async function logout(userId: string): Promise<void> {
  const { invalidateSessionRevocation } = await import("../lib/auth");
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
  invalidateSessionRevocation(userId);
}

export async function me(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      suspendedUntil: true,
      permanentlyBanned: true,
      alertPreference: true,
      deletedAt: true,
      mfaEnabled: true,
    },
  });
  // v106 — return a clean 401 instead of a raw findUniqueOrThrow 500 when the
  // account is gone (hard delete) or soft-deleted (row present, deletedAt set).
  // Covers the brief per-instance session-revocation cache window so a
  // just-deleted user neither 500s nor sees their own profile back.
  if (!user || user.deletedAt) throw new HttpError(401, "session_revoked");
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    suspendedUntil: user.suspendedUntil,
    permanentlyBanned: user.permanentlyBanned,
    alertPreference: user.alertPreference,
    // fix(audit auth-mfa-unreachable-3): surface MFA state so the settings UI can
    // show enable vs disable. An anonymous device account is identifiable by its
    // device-*@*.local email; the UI only offers MFA to registered accounts.
    mfaEnabled: user.mfaEnabled,
  };
}
