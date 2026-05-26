import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { signSession } from "../lib/jwt.js";
import { env } from "../env.js";
import { HttpError } from "../middleware/error.js";

export async function register(email: string, password: string, displayName?: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new HttpError(409, "email_taken");

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { email, passwordHash, displayName },
    select: { id: true, email: true, displayName: true },
  });
  return { user, token: signSession({ uid: user.id, email: user.email }) };
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
