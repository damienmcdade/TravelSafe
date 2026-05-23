import { NextResponse, type NextRequest } from "next/server";

/// Per-IP rate limiter for public API endpoints. Built on a simple
/// fixed-window counter held in module memory at the edge runtime —
/// each Vercel function instance has its own map, so the actual
/// effective cap is N_instances × per-instance limit. That's
/// intentional: we want a coarse abuse cap that doesn't require KV
/// storage and doesn't add network latency to every request. Real
/// DDoS protection still relies on Vercel's platform-level WAF.
///
/// Why we limit at all: the crime-data adapters fan out to external
/// upstreams (Socrata, ArcGIS, CKAN). Sustained hammering of
/// /api/safezone/safety-score or /api/coverage would burn through
/// our upstream quota and could trigger account suspension at
/// data.lacity.org / data.boston.gov / etc — even though each
/// individual call is itself cached locally.
///
/// Routes covered (and their bucket caps per 60s window):
///   /api/safezone/*    → 60   (citywide score / trend; per-tab on load)
///   /api/crime-data/*  → 60   (Awareness / Map data)
///   /api/coverage      → 30   (only the /coverage page polls this)
///   /api/geo/*         → 60   (areas list — every tab on city change)
///   /api/community/*   → 30   (posts feed; lower because writes too)
///   /api/news          → 30
///   /api/assistant     → 10   (AI streaming is the most expensive)
///
/// Routes SKIPPED (have their own auth / are low-risk):
///   /api/cron/*        — Bearer CRON_SECRET protected
///   /api/auth/*        — bootstrap flow can legitimately burst
///   /api/safety/*      — per-user session auth
///   /api/preferences/* — per-user session auth
///   /api/moderation/*  — per-user session auth
///   /api/share/*       — token-protected
///   /api/contacts/*    — token-protected

interface BucketEntry {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 60_000;

// Per-path-prefix limit table. Longest-prefix match wins.
const LIMITS: Array<{ prefix: string; cap: number }> = [
  { prefix: "/api/assistant",     cap: 10 },
  { prefix: "/api/coverage",      cap: 30 },
  { prefix: "/api/community",     cap: 30 },
  { prefix: "/api/news",          cap: 30 },
  { prefix: "/api/safezone/",     cap: 60 },
  { prefix: "/api/crime-data/",   cap: 60 },
  { prefix: "/api/geo/",          cap: 60 },
];

// Path prefixes that are NEVER rate-limited (they're auth-protected
// or part of bootstrap / token-issued flows).
const SKIP_PREFIXES = [
  "/api/cron/",
  "/api/auth/",
  "/api/safety/",
  "/api/preferences/",
  "/api/moderation/",
  "/api/share/",
  "/api/contacts/",
];

// IP → bucket. Bounded with a soft cap on entries; if exceeded, we
// evict the oldest. Edge runtime instances don't share memory so
// each Vercel function holds its own map.
const buckets = new Map<string, BucketEntry>();
const MAX_BUCKETS = 5_000;

function pickLimit(pathname: string): number | null {
  // Longest prefix wins so "/api/coverage" doesn't accidentally match
  // a hypothetical "/api/coverage-deep" the wrong way.
  let best: { prefix: string; cap: number } | null = null;
  for (const rule of LIMITS) {
    if (pathname === rule.prefix || pathname.startsWith(rule.prefix)) {
      if (!best || rule.prefix.length > best.prefix.length) best = rule;
    }
  }
  return best?.cap ?? null;
}

function clientIp(req: NextRequest): string {
  // Vercel sets x-forwarded-for and x-real-ip. Take the first hop.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri;
  return "unknown";
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip everything that isn't an API route.
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  // Skip auth-protected / bootstrap routes.
  if (SKIP_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const cap = pickLimit(pathname);
  if (cap == null) return NextResponse.next();

  const ip = clientIp(req);
  // Bucket key includes the prefix so a user hitting many different
  // route families isn't unfairly throttled by a single noisy one.
  const ruleKey = LIMITS.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix))?.prefix ?? "";
  const key = `${ip}|${ruleKey}`;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
  }
  bucket.count += 1;
  buckets.set(key, bucket);

  // Cheap eviction: when we get too big, drop oldest 20% by windowStart.
  if (buckets.size > MAX_BUCKETS) {
    const entries = Array.from(buckets.entries()).sort((a, b) => a[1].windowStart - b[1].windowStart);
    for (let i = 0; i < Math.floor(MAX_BUCKETS * 0.2); i++) buckets.delete(entries[i][0]);
  }

  if (bucket.count > cap) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - bucket.windowStart)) / 1000);
    return new NextResponse(
      JSON.stringify({
        error: "rate_limited",
        message: `Too many requests to ${ruleKey}. Limit: ${cap} per minute per IP. Retry in ${retryAfter}s.`,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(cap),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil((bucket.windowStart + WINDOW_MS) / 1000)),
        },
      },
    );
  }

  // Pass through with rate-limit headers so clients can self-throttle.
  const res = NextResponse.next();
  res.headers.set("X-RateLimit-Limit", String(cap));
  res.headers.set("X-RateLimit-Remaining", String(Math.max(0, cap - bucket.count)));
  res.headers.set("X-RateLimit-Reset", String(Math.ceil((bucket.windowStart + WINDOW_MS) / 1000)));
  return res;
}

// Only run on API routes — exclude every page, static asset, and image
// route from the middleware so we don't add latency to non-API traffic.
export const config = {
  matcher: ["/api/:path*"],
};
