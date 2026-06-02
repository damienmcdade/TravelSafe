import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { HttpError } from "./http";
import { prisma } from "./prisma";
import { verifySession, type SessionPayload } from "./jwt";

/// v106 (security audit) — token revocation on the web surface. The JWT only
/// carries {uid,email} (no tokenVersion), and verifySession previously checked
/// just the signature, so a soft-deleted (account-purge cron sets deletedAt) or
/// permanently-banned user's token stayed valid for the full 24h TTL on every
/// web route. We can't do version-based revocation without re-issuing tokens,
/// but we CAN reject deleted/banned accounts. A short per-instance cache keeps
/// this to ~one DB read per user per minute (same model as the edge limiter;
/// the Express side uses the equivalent token-version-cache). Worst-case
/// staleness drops from 24h to REVOCATION_TTL_MS.
const REVOCATION_TTL_MS = 60_000;
const revocationCache = new Map<string, { revoked: boolean; checkedAt: number }>();
const REVOCATION_CACHE_MAX = 10_000;

async function isSessionRevoked(uid: string): Promise<boolean> {
  const now = Date.now();
  const hit = revocationCache.get(uid);
  if (hit && now - hit.checkedAt < REVOCATION_TTL_MS) return hit.revoked;
  let revoked = false;
  try {
    const user = await prisma.user.findUnique({
      where: { id: uid },
      select: { deletedAt: true, permanentlyBanned: true },
    });
    revoked = !user || user.deletedAt != null || user.permanentlyBanned === true;
  } catch {
    // DB blip — fail OPEN (don't lock everyone out on a transient error); the
    // next request re-checks. Revocation is 401-hardening, not the only gate
    // (owned-resource queries still scope by userId + filter deletedAt).
    return false;
  }
  if (revocationCache.size > REVOCATION_CACHE_MAX) revocationCache.clear();
  revocationCache.set(uid, { revoked, checkedAt: now });
  return revoked;
}

/// Extract + verify the session from an Authorization header, then confirm the
/// account isn't deleted/banned. Throws HttpError(401) on missing/invalid/
/// revoked token; route handlers catch via wrap().
export async function requireSession(req: NextRequest): Promise<SessionPayload> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "missing_bearer_token");
  }
  let session: SessionPayload;
  try {
    session = verifySession(header.slice("Bearer ".length));
  } catch {
    throw new HttpError(401, "invalid_token");
  }
  if (await isSessionRevoked(session.uid)) {
    throw new HttpError(401, "session_revoked");
  }
  return session;
}

/// Same but returns null instead of throwing — for endpoints that work
/// anonymously but personalize when signed in. A revoked account resolves to
/// null (treated as anonymous).
export async function optionalSession(req: NextRequest): Promise<SessionPayload | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  let session: SessionPayload;
  try {
    session = verifySession(header.slice("Bearer ".length));
  } catch {
    return null;
  }
  if (await isSessionRevoked(session.uid)) return null;
  return session;
}

/// Invalidate the cached revocation state for a user (call after delete/ban so
/// the change takes effect immediately rather than after the TTL).
export function invalidateSessionRevocation(uid: string): void {
  revocationCache.delete(uid);
}

export function requireModerator(session: SessionPayload, moderatorEmailsCsv: string) {
  const list = moderatorEmailsCsv.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.includes(session.email.toLowerCase())) {
    throw new HttpError(403, "moderator_only");
  }
}

export type { SessionPayload };
export { NextResponse };
