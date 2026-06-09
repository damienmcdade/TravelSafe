import "server-only";
import { NextResponse, type NextRequest } from "next/server";

// v60 — public read-route rate limiter. The Express side has
// express-rate-limit on write endpoints; the Vercel-side public
// read routes (/api/crime-data/*, /api/safezone/*, /api/geo/*)
// had no protection. A bot hitting /api/crime-data/citywide?city=detroit
// in a tight loop would hammer the 5-min adapter cache window and
// blow through both Vercel function quota and the upstream police
// data sources' (unknown) rate limits.
//
// Per-instance in-memory token bucket. Limits:
//   - Doesn't survive cold starts (acceptable: first request always
//     passes, sustained abuse still throttled on the same warm instance)
//   - Doesn't enforce across Vercel instances (acceptable for "stop
//     a single-IP bot"; cross-instance enforcement would need Redis
//     and the Vercel side doesn't currently hold a Redis client)
//
// Defaults are designed to comfortably allow legitimate human + bot
// (search-crawl, opengraph-image regen) traffic while choking off
// scrape-style abuse.

interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();

const DEFAULT_LIMIT = 60;        // requests per window per IP
const DEFAULT_WINDOW_MS = 60_000; // 60s

// Hard cap on the bucket map so memory can't grow unbounded under a
// distributed-source attack pattern. When we hit the cap, evict the
// oldest entries by reset time (Map preserves insertion order, and we
// re-insert on increment so newest-touched is always at the back).
const MAX_BUCKETS = 5_000;

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

interface Options {
  /// Max requests per IP per window. Default 60.
  limit?: number;
  /// Window length in ms. Default 60_000.
  windowMs?: number;
  /// Bucket-key suffix so different route families have independent
  /// counters (e.g. /api/geo/* and /api/crime-data/* don't compete).
  scope?: string;
}

/// Returns null when the request is within the rate limit. Returns a
/// 429 NextResponse with standard headers when over-limit.
export function rateLimit(req: NextRequest, opts: Options = {}): NextResponse | null {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const scope = opts.scope ?? "default";
  const key = `${scope}:${clientIp(req)}`;
  const now = Date.now();

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
  }
  bucket.count += 1;
  buckets.delete(key); // re-insert at the back so eviction is LRU-ish
  buckets.set(key, bucket);

  if (buckets.size > MAX_BUCKETS) {
    const firstKey = buckets.keys().next().value;
    if (firstKey !== undefined) buckets.delete(firstKey);
  }

  // v96 — `remaining` was computed here but only used implicitly
  // (we hardcode "RateLimit-Remaining: 0" on the 429 path because by
  // definition the bucket is empty when we hit the limit, and the
  // success path returns null which can't carry headers). Dropping
  // the dead local.
  const resetSec = Math.ceil(bucket.resetAt / 1000);

  if (bucket.count > limit) {
    return NextResponse.json(
      { error: "rate_limited", message: `Too many requests. Try again in ${Math.ceil((bucket.resetAt - now) / 1000)}s.` },
      {
        status: 429,
        headers: {
          "RateLimit-Limit": String(limit),
          "RateLimit-Remaining": "0",
          "RateLimit-Reset": String(resetSec),
          "Retry-After": String(Math.ceil((bucket.resetAt - now) / 1000)),
        },
      },
    );
  }
  return null;
}

/// Reset all buckets — only for tests.
export function _resetForTest(): void { buckets.clear(); }

// ---------------------------------------------------------------------------
// Distributed (Redis-backed) fixed-window limiter. Unlike the in-memory bucket
// above, this enforces ACROSS all Vercel instances — required for limits that
// must be globally accurate (e.g. anonymous community posting, where the
// per-instance bucket would let an attacker get N_instances × the cap). Fails
// OPEN (returns null) when Redis is unset or errors, so the caller MUST keep its
// own coarser bound (DB count / in-memory bucket) as the floor.
import { getRedis } from "./redis";

/// Vercel-attested client IP. Prefers x-real-ip (cannot be spoofed past Vercel's
/// proxy); falls back to the LAST x-forwarded-for hop (the trusted proxy's), not
/// the client-controlled leftmost token. Mirrors middleware.ts clientIp().
export function attestedClientIp(req: NextRequest): string {
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return "unknown";
}

/// Increment a per-key fixed-window counter in Redis. Returns { count, limited }
/// or null when Redis is unavailable (caller falls back to its own bound).
export async function distributedRateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<{ count: number; limited: boolean } | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const k = `rl:${key}`;
    const count = await redis.incr(k);
    // Set the TTL only when the window opens (count === 1) so the window is
    // fixed, not sliding-on-every-hit.
    if (count === 1) await redis.expire(k, windowSec);
    return { count, limited: count > limit };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// DB-backed fixed-window counter. Vercel's serverless runtime is stateless with
// no instance affinity, so the in-memory bucket above can't reliably enforce a
// per-IP cap (a paced trickle spreads across instances) and Redis isn't wired on
// the web runtime (REDIS_URL unset → getRedis() null). Postgres (Neon), however,
// is ALWAYS reachable from the web runtime — the app already uses it — and is a
// single shared store, so an atomic INSERT…ON CONFLICT increment gives accurate
// CROSS-instance per-IP enforcement with no Redis and no schema migration (the
// table is created on first use). The IP is sha256-hashed (never stored raw) and
// rows are short-lived (cleaned by the purge cron), so this is a privacy-safe,
// ephemeral abuse-prevention counter.
import { prisma } from "./prisma";
import { createHash } from "node:crypto";

function ipHash(ip: string): string {
  return createHash("sha256").update(`anonpost:${ip}`).digest("hex").slice(0, 32);
}

let anonRateTableReady = false;
async function ensureAnonRateTable(): Promise<void> {
  if (anonRateTableReady) return;
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "AnonPostRate" (` +
    `"key" text PRIMARY KEY, "count" integer NOT NULL DEFAULT 0, "expiresAt" timestamptz NOT NULL)`,
  );
  anonRateTableReady = true;
}

/// Atomic fixed-window increment in Postgres. Returns true if over `limit`.
async function dbWindowLimited(key: string, limit: number, windowSec: number): Promise<boolean> {
  await ensureAnonRateTable();
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSec / windowSec) * windowSec; // fixed-window id
  const k = `${key}:${windowStart}`;
  const expiresAt = new Date((windowStart + windowSec) * 1000);
  // Parameterized ($1/$2) — no string interpolation, no injection surface.
  const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `INSERT INTO "AnonPostRate" ("key","count","expiresAt") VALUES ($1, 1, $2) ` +
    `ON CONFLICT ("key") DO UPDATE SET "count" = "AnonPostRate"."count" + 1 RETURNING "count"`,
    k,
    expiresAt,
  );
  return Number(rows[0]?.count ?? 1) > limit;
}

/// Deletes expired AnonPostRate rows. Called by the daily purge cron so the
/// table never grows unbounded. Returns the number of rows removed.
export async function purgeExpiredAnonPostRate(): Promise<number> {
  try {
    await ensureAnonRateTable();
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `WITH d AS (DELETE FROM "AnonPostRate" WHERE "expiresAt" < now() RETURNING 1) SELECT count(*)::bigint AS count FROM d`,
    );
    return Number(rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

/// Per-IP rate gate for ANONYMOUS community posts. Uses Redis when configured
/// (lowest latency, cross-instance) and otherwise the DB-backed counter (also
/// cross-instance, always reachable from Vercel). Both burst + daily windows are
/// keyed on the sha256-hashed attested IP. Returns true if the request should be
/// rejected (429). FAILS OPEN on infra error — the global per-author DB cap in the
/// route remains the absolute backstop regardless.
export async function anonPostLimited(
  req: NextRequest,
  opts: { burstLimit: number; burstWindowSec: number; dailyLimit: number; scope?: string },
): Promise<boolean> {
  const h = ipHash(attestedClientIp(req));
  // scope keeps separate budgets per write type (e.g. "post" vs "comment") so
  // commenting can't exhaust the posting budget and vice-versa.
  const s = opts.scope ?? "post";
  // Fast path: Redis, when REDIS_URL is wired on the web runtime.
  const burstR = await distributedRateLimit(`anon:${s}:burst:${h}`, opts.burstLimit, opts.burstWindowSec);
  const dailyR = await distributedRateLimit(`anon:${s}:day:${h}`, opts.dailyLimit, 24 * 60 * 60);
  if (burstR || dailyR) return Boolean(burstR?.limited || dailyR?.limited);
  // Redis absent/errored → DB-backed counter (the reliable path on Vercel today).
  try {
    const [burst, daily] = await Promise.all([
      dbWindowLimited(`anon:${s}:burst:${h}`, opts.burstLimit, opts.burstWindowSec),
      dbWindowLimited(`anon:${s}:day:${h}`, opts.dailyLimit, 24 * 60 * 60),
    ]);
    return burst || daily;
  } catch {
    return false; // fail open
  }
}
