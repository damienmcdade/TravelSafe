import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { signSession } from "../lib/jwt";
import { env } from "../lib/env";
import { HttpError } from "../lib/http";

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
    select: { id: true, email: true, displayName: true },
  });
  return { user, token: signSession({ uid: user.id, email: user.email }) };
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

  return {
    user: { id: user.id, email: user.email, displayName: user.displayName },
    token: signSession({ uid: user.id, email: user.email }),
  };
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
