import "server-only";
import { createHash } from "node:crypto";
import { generateSecret, generateURI, verifySync } from "otplib";
import { prisma } from "../lib/prisma";
import { getRedis } from "../lib/redis";
import { HttpError } from "../lib/http";
import { encryptSecret, decryptSecret } from "../lib/secret-crypto";

// fix(audit mfa-verify-enroll-500): otplib's verifySync THROWS (not returns false)
// when the base32 `secret` is malformed. verifyAndEnableMfa takes the secret from
// the client request body, so a junk secret surfaced as an uncaught HTTP 500.
// Treat any throw as a failed verification (fail closed) so callers get a clean
// 401 instead. Safe to use everywhere — stored secrets are always valid base32.
function safeVerify(secret: string, token: string): boolean {
  try {
    return verifySync({ secret, token }).valid;
  } catch {
    return false;
  }
}

// fix(audit pentest-authn-1 / auth-mfa-unreachable-3): MFA was fully built on
// the Express API but unreachable from the web (Vercel) surface the client
// actually calls. This is the web port — standard TOTP (6-digit / 30s) codes
// compatible with Google Authenticator, Authy, 1Password, Bitwarden. Mirrors
// apps/api/src/services/mfa.service.ts so the two stacks behave identically.
const ISSUER = "CommunitySafe";

export interface EnrollProvisional {
  secret: string; // base32 secret to render as a QR code
  otpauthUrl: string; // otpauth://totp/...
  issuer: string;
  account: string;
}

// Provisional secret — NOT stored on the user until verifyAndEnableMfa confirms
// the enrolling device can produce a valid code.
export function generateProvisional(account: string): EnrollProvisional {
  const secret = generateSecret({ length: 20 });
  const otpauthUrl = generateURI({ secret, label: account, issuer: ISSUER });
  return { secret, otpauthUrl, issuer: ISSUER, account };
}

export async function verifyAndEnableMfa(userId: string, secret: string, code: string): Promise<void> {
  if (!safeVerify(secret, code)) throw new HttpError(401, "mfa_invalid_code");
  await prisma.user.update({
    where: { id: userId },
    // fix(audit pentest-authn-7): store the secret encrypted at rest.
    data: { mfaSecret: encryptSecret(secret), mfaEnabled: true },
  });
}

// `storedSecret` is the value persisted on the user row (encrypted or legacy
// plaintext); decryptSecret transparently handles both.
export function verifyMfaCode(storedSecret: string, code: string): boolean {
  return safeVerify(decryptSecret(storedSecret), code);
}

// fix(audit mfa-totp-replay): RFC 6238 §5.2 — "the verifier MUST NOT accept the
// second attempt of the OTP after the successful validation has been issued for
// the first OTP." otplib's verifySync alone accepts the same code repeatedly
// within its ~90s window (one valid code observed via shoulder-surf / intercept
// could be replayed to mint a session). Enforce single-use via an ephemeral
// Redis key (SET NX, TTL = the code's max validity) keyed by user + code hash.
// Returns true when the code is FRESH (caller may proceed) and false when it was
// already consumed (replay → caller must reject). Fail-OPEN if Redis is down:
// replay protection is best-effort and must never lock a legitimate user out of
// MFA because the cache is unavailable; the code's 30s rotation remains the
// primary control. The code is hashed (not stored raw) since it's a 6-digit
// secret-adjacent value.
const MFA_REPLAY_WINDOW_S = 90;
export async function consumeMfaCode(userId: string, code: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true; // no cache → can't dedup; degrade gracefully
  const key = `mfa:used:${userId}:${createHash("sha256").update(code).digest("hex")}`;
  try {
    // SET NX returns "OK" on first write, null when the key already exists.
    const res = await redis.set(key, "1", "EX", MFA_REPLAY_WINDOW_S, "NX");
    return res === "OK";
  } catch (err) {
    console.warn("[mfa] replay-guard redis error:", (err as Error).message);
    return true; // fail open
  }
}

export async function disableMfa(userId: string, code: string): Promise<void> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfaEnabled: true, mfaSecret: true },
  });
  if (!u || !u.mfaEnabled || !u.mfaSecret) throw new HttpError(400, "mfa_not_enabled");
  if (!safeVerify(decryptSecret(u.mfaSecret), code)) throw new HttpError(401, "mfa_invalid_code");
  await prisma.user.update({
    where: { id: userId },
    data: { mfaEnabled: false, mfaSecret: null },
  });
}
