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
