// v93p3 — TOTP-based MFA (DISA STIG IA-2(1)). Standard 6-digit
// 30s-period codes compatible with Google Authenticator, Authy, 1Password,
// Bitwarden. Enrollment flow:
//   1. POST /auth/mfa/enroll → returns base32 secret + otpauth:// URI
//      (QR-encodable on the client) — secret is provisional, NOT
//      stored on the user yet.
//   2. POST /auth/mfa/verify-enroll with the user's first code →
//      stores mfaSecret + sets mfaEnabled=true.
//   3. POST /auth/login first returns a partial token + mfaRequired:true
//      if the user has mfaEnabled. Client then POSTs to /auth/mfa/verify
//      with code + partial token → returns full access+refresh pair.
//   4. POST /auth/mfa/disable requires a current code to disable.
import { createHash } from "node:crypto";
import { generateSecret, generateURI, verifySync } from "otplib";
import { prisma } from "../lib/prisma.js";
import { getRedis } from "../lib/redis.js";
import { HttpError } from "../middleware/error.js";
import { encryptSecret, decryptSecret } from "../lib/secret-crypto.js";

const ISSUER = "CommunitySafe";

export interface EnrollProvisional {
  secret: string;          // base32 secret to render as QR
  otpauthUrl: string;      // otpauth://totp/...
  issuer: string;
  account: string;
}

// v93p3 — otplib v13+ functional API: generateSecret() → base32 string,
// generateURI() → otpauth:// URI, verifySync() → boolean. The default
// step (30s) and digit count (6) match Google Authenticator's expectation.
export function generateProvisional(account: string): EnrollProvisional {
  const secret = generateSecret({ length: 20 });
  const otpauthUrl = generateURI({ secret, label: account, issuer: ISSUER });
  return { secret, otpauthUrl, issuer: ISSUER, account };
}

export async function verifyAndEnableMfa(userId: string, secret: string, code: string): Promise<void> {
  if (!(verifySync({ secret, token: code }).valid)) throw new HttpError(401, "mfa_invalid_code");
  await prisma.user.update({
    where: { id: userId },
    // fix(audit pentest-authn-7): store the secret encrypted at rest.
    data: { mfaSecret: encryptSecret(secret), mfaEnabled: true },
  });
}

// `storedSecret` is the persisted value (encrypted or legacy plaintext).
export function verifyMfaCode(storedSecret: string, code: string): boolean {
  return (verifySync({ secret: decryptSecret(storedSecret), token: code }).valid);
}

// fix(audit mfa-totp-replay): RFC 6238 §5.2 — a validated TOTP code MUST NOT be
// accepted twice. otplib's verifySync alone accepts the same code repeatedly
// within its ~90s window. Enforce single-use via an ephemeral Redis key (SET NX,
// TTL = the code's max validity), keyed by user + code hash. Returns true when
// FRESH (caller proceeds), false on replay (caller rejects). Fail-OPEN if Redis
// is down — replay protection is best-effort and must never lock a user out of
// MFA over a cache outage; the 30s rotation stays the primary control. Mirrors
// the apps/web port so both stacks behave identically.
const MFA_REPLAY_WINDOW_S = 90;
export async function consumeMfaCode(userId: string, code: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;
  const key = `mfa:used:${userId}:${createHash("sha256").update(code).digest("hex")}`;
  try {
    const res = await redis.set(key, "1", "EX", MFA_REPLAY_WINDOW_S, "NX");
    return res === "OK";
  } catch (err) {
    console.warn("[mfa] replay-guard redis error:", (err as Error).message);
    return true;
  }
}

export async function disableMfa(userId: string, code: string): Promise<void> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { mfaEnabled: true, mfaSecret: true },
  });
  if (!u || !u.mfaEnabled || !u.mfaSecret) throw new HttpError(400, "mfa_not_enabled");
  if (!verifySync({ secret: decryptSecret(u.mfaSecret), token: code }).valid) throw new HttpError(401, "mfa_invalid_code");
  await prisma.user.update({
    where: { id: userId },
    data: { mfaEnabled: false, mfaSecret: null },
  });
}
