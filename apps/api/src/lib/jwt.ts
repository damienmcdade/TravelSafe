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

export function signAccessToken(payload: Omit<SessionPayload, "typ">): string {
  const options: SignOptions = { expiresIn: ACCESS_TTL };
  return jwt.sign({ ...payload, typ: "access" }, env.JWT_SECRET, options);
}

export function signRefreshToken(payload: Omit<SessionPayload, "typ">): string {
  const options: SignOptions = { expiresIn: REFRESH_TTL };
  return jwt.sign({ ...payload, typ: "refresh" }, env.JWT_SECRET, options);
}

// Legacy alias for callers that still want a one-shot token. Mints an
// access token. Existing routes (register, login) are switched to
// signAccessToken + signRefreshToken in the same patch.
export function signSession(payload: Omit<SessionPayload, "typ">): string {
  return signAccessToken(payload);
}

export function verifySession(token: string, opts?: { expectType?: "access" | "refresh" }): SessionPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
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
  if (opts?.expectType && p.typ && p.typ !== opts.expectType) {
    throw new Error(`expected ${opts.expectType} token, got ${p.typ}`);
  }
  return { uid: p.uid, email: p.email, ver, typ: p.typ };
}
