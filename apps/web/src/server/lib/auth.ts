import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { HttpError } from "./http";
import { prisma } from "./prisma";
import { verifySession, type SessionPayload } from "./jwt";
import { readSessionCookie } from "./session-cookie";
import { env } from "./env";
import { TrustLevel } from "@/generated/prisma/client";

/// fix(audit pentest-authn-4): the session token can arrive two ways now — the
/// HttpOnly `cs_session` cookie (preferred; not readable by JS, so XSS-safe) or
/// the legacy `Authorization: Bearer` header (mobile native + localStorage
/// sessions still migrating). Prefer the cookie, fall back to the header.
function extractRawToken(req: NextRequest): string | null {
  const cookie = readSessionCookie(req);
  if (cookie) return cookie;
  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  return null;
}

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
const REVOCATION_CACHE_MAX = 10_000;

// fix(audit auth-no-revocation-web-2): cache the user's current tokenVersion
// alongside the deleted/banned state so requireSession can reject a token whose
// ver is behind (logout / password change / sign-out-everywhere bumps it).
const revocationCache = new Map<string, { revoked: boolean; tokenVersion: number; checkedAt: number }>();

async function getRevocationState(uid: string): Promise<{ revoked: boolean; tokenVersion: number }> {
  const now = Date.now();
  const hit = revocationCache.get(uid);
  if (hit && now - hit.checkedAt < REVOCATION_TTL_MS) return { revoked: hit.revoked, tokenVersion: hit.tokenVersion };
  let revoked = false;
  let tokenVersion = 0;
  try {
    const user = await prisma.user.findUnique({
      where: { id: uid },
      select: { deletedAt: true, permanentlyBanned: true, tokenVersion: true },
    });
    revoked = !user || user.deletedAt != null || user.permanentlyBanned === true;
    tokenVersion = user?.tokenVersion ?? 0;
  } catch {
    // DB blip — fail OPEN (don't lock everyone out on a transient error); the
    // next request re-checks. Revocation is 401-hardening, not the only gate
    // (owned-resource queries still scope by userId + filter deletedAt).
    return { revoked: false, tokenVersion: 0 };
  }
  if (revocationCache.size > REVOCATION_CACHE_MAX) revocationCache.clear();
  revocationCache.set(uid, { revoked, tokenVersion, checkedAt: now });
  return { revoked, tokenVersion };
}

/// Returns true if the token must be rejected: account deleted/banned, OR the
/// token's version is behind the user's current tokenVersion.
async function isTokenInvalid(session: SessionPayload): Promise<boolean> {
  const { revoked, tokenVersion } = await getRevocationState(session.uid);
  if (revoked) return true;
  return (session.ver ?? 0) < tokenVersion;
}

/// Extract + verify the session from an Authorization header, then confirm the
/// account isn't deleted/banned. Throws HttpError(401) on missing/invalid/
/// revoked token; route handlers catch via wrap().
export async function requireSession(req: NextRequest): Promise<SessionPayload> {
  const raw = extractRawToken(req);
  if (!raw) {
    throw new HttpError(401, "missing_bearer_token");
  }
  let session: SessionPayload;
  try {
    session = verifySession(raw);
  } catch {
    throw new HttpError(401, "invalid_token");
  }
  if (await isTokenInvalid(session)) {
    throw new HttpError(401, "session_revoked");
  }
  return session;
}

/// Same but returns null instead of throwing — for endpoints that work
/// anonymously but personalize when signed in. A revoked account resolves to
/// null (treated as anonymous).
export async function optionalSession(req: NextRequest): Promise<SessionPayload | null> {
  const raw = extractRawToken(req);
  if (!raw) return null;
  let session: SessionPayload;
  try {
    session = verifySession(raw);
  } catch {
    return null;
  }
  if (await isTokenInvalid(session)) return null;
  return session;
}

/// Invalidate the cached revocation state for a user (call after delete/ban so
/// the change takes effect immediately rather than after the TTL).
export function invalidateSessionRevocation(uid: string): void {
  revocationCache.delete(uid);
}

// fix(audit dual-auth-weaker-web): the web moderation surface (Vercel, prod-
// primary) previously authorized by a static MODERATOR_EMAILS env-CSV email
// match only — so a DB-demoted moderator kept web access, and anyone still
// listed in the env var was a moderator regardless of trust state. Port the
// canonical RBAC from apps/api: trustLevel === MODERATOR is authoritative; the
// env-CSV is honored ONLY as a bootstrap path while zero real moderators exist
// AND within 24h of process boot. Banned/suspended users are always rejected.
const MOD_BOOT_TIME = Date.now();
const MOD_BOOTSTRAP_GRACE_MS = 24 * 60 * 60 * 1000;
export async function requireModerator(session: SessionPayload): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: session.uid },
    select: { trustLevel: true, email: true, suspendedUntil: true, permanentlyBanned: true },
  });
  if (!user) throw new HttpError(403, "moderator_only");
  if (user.permanentlyBanned || (user.suspendedUntil && user.suspendedUntil > new Date())) {
    throw new HttpError(403, "moderator_only");
  }
  if (user.trustLevel === TrustLevel.MODERATOR) return;
  const moderatorCount = await prisma.user.count({ where: { trustLevel: TrustLevel.MODERATOR } });
  if (moderatorCount > 0) throw new HttpError(403, "moderator_only");
  if (Date.now() - MOD_BOOT_TIME > MOD_BOOTSTRAP_GRACE_MS) {
    throw new HttpError(403, "moderator_bootstrap_window_closed");
  }
  const list = (env.MODERATOR_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.includes((user.email ?? "").toLowerCase())) {
    throw new HttpError(403, "moderator_only");
  }
}

export type { SessionPayload };
export { NextResponse };
