import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../env.js";

export interface SessionPayload {
  uid: string;
  email: string;
  ver: number;  // v93p2 — token version (revocation cursor)
  typ?: "access" | "refresh";  // v93p2 — token type
}

// v93p2 — split short-TTL access token + long-TTL refresh token.
// Access: 15 min (DISA STIG AC-12 idle-session timeout).
// Refresh: 30 days. Refresh tokens carry `typ:"refresh"` so the
// middleware rejects them on protected routes; they're only accepted
// at /auth/refresh which returns a fresh access token if the user's
// tokenVersion still matches.
const ACCESS_TTL = "15m";
const REFRESH_TTL = "30d";
// v96 — short-lived ticket returned by /auth/login when MFA is
// required. Carries only the userId so /auth/mfa/verify can identify
// the challenge without trusting a body-supplied id. 5 minutes is
// generous for code entry; outside that window the user re-logs in.
const MFA_PENDING_TTL = "5m";

export function signAccessToken(payload: Omit<SessionPayload, "typ">): string {
  const options: SignOptions = { expiresIn: ACCESS_TTL };
  return jwt.sign({ ...payload, typ: "access" }, env.JWT_SECRET, options);
}

export function signRefreshToken(payload: Omit<SessionPayload, "typ">): string {
  const options: SignOptions = { expiresIn: REFRESH_TTL };
  return jwt.sign({ ...payload, typ: "refresh" }, env.JWT_SECRET, options);
}

// v96 — sign + verify the MFA-pending ticket. Holds only the uid so
// the body can't be tampered to challenge a different user; the
// authLimiter on /auth/mfa/verify still rate-limits per-IP on top.
export function signMfaPendingToken(uid: string): string {
  const options: SignOptions = { expiresIn: MFA_PENDING_TTL };
  return jwt.sign({ uid, typ: "mfa_pending" }, env.JWT_SECRET, options);
}

export function verifyMfaPendingToken(token: string): { uid: string } {
  // fix(security): pin the algorithm to HS256 (matches the web side) so an
  // asymmetric key, if ever introduced, can never enable an alg-confusion forge.
  const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
  if (typeof decoded !== "object" || !decoded) throw new Error("Invalid mfa pending token");
  const p = decoded as { uid?: unknown; typ?: unknown };
  if (p.typ !== "mfa_pending" || typeof p.uid !== "string") {
    throw new Error("Invalid mfa pending token");
  }
  return { uid: p.uid };
}

// Legacy alias for callers that still want a one-shot token. Mints an
// access token. Existing routes (register, login) are switched to
// signAccessToken + signRefreshToken in the same patch.
export function signSession(payload: Omit<SessionPayload, "typ">): string {
  return signAccessToken(payload);
}

export function verifySession(token: string, opts?: { expectType?: "access" | "refresh" }): SessionPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
  if (typeof decoded !== "object" || !decoded || !("uid" in decoded)) {
    throw new Error("Invalid session payload");
  }
  const p = decoded as Partial<SessionPayload>;
  if (typeof p.uid !== "string" || typeof p.email !== "string") {
    throw new Error("Invalid session payload");
  }
  // v93p2 — ver defaults to 0 for legacy tokens minted before the
  // tokenVersion column existed. Once a user changes their password
  // (incrementing tokenVersion to 1+), legacy tokens fail the revoke
  // check in middleware/auth.ts.
  const ver = typeof p.ver === "number" ? p.ver : 0;
  // Enforce token type when the caller specifies one (access for
  // protected routes, refresh for /auth/refresh).
  // fix(audit auth-token-type-confusion-7 / api-code-5): FAIL CLOSED. The prior
  // `&& p.typ` let a token with NO typ claim slip past the type check, so e.g. an
  // mfa-pending or refresh token (or a forged one omitting typ) could be accepted
  // where an access token was required. All current minting sets typ, and legacy
  // typ-less tokens are long expired, so requiring typ === expectType is safe.
  if (opts?.expectType && p.typ !== opts.expectType) {
    throw new Error(`expected ${opts.expectType} token, got ${p.typ ?? "none"}`);
  }
  return { uid: p.uid, email: p.email, ver, typ: p.typ };
}
