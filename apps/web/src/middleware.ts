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

// fix(audit pentest-csp-unsafe-inline): per-request nonce + strict-dynamic CSP.
// Moved off the static next.config header so script-src no longer relies on
// 'unsafe-inline' for CSP3 browsers. The nonce is propagated to Next via the
// request `content-security-policy` header (Next reads it and nonces its own
// + next/script tags — the AdSense loader and AdSlot included). 'unsafe-inline'
// is KEPT only as the CSP-Level-2 fallback: browsers that support
// 'strict-dynamic' ignore both 'unsafe-inline' and the host allowlist, while
// older browsers ignore 'strict-dynamic' and keep working. JSON-LD blocks are
// application/ld+json (data, not governed by script-src), so they need no nonce.
const ADSENSE_ORIGINS =
  "https://pagead2.googlesyndication.com " +
  "https://googleads.g.doubleclick.net " +
  "https://www.googletagservices.com " +
  "https://ep1.adtrafficquality.google " +
  "https://www.google.com";

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `img-src 'self' data: blob: https://upload.wikimedia.org https://*.basemaps.cartocdn.com https://*.googleusercontent.com ${ADSENSE_ORIGINS}`,
    `script-src 'self' 'unsafe-inline' 'nonce-${nonce}' 'strict-dynamic' ${ADSENSE_ORIGINS}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `connect-src 'self' https://communitysafe-api-production.up.railway.app https://nominatim.openstreetmap.org ${ADSENSE_ORIGINS}`,
    `frame-src ${ADSENSE_ORIGINS}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function applyCsp(res: NextResponse, csp: string): NextResponse {
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

// Per-path-prefix limit table. Longest-prefix match wins.
// Audit added: /api/route (safe-route planner — DB + 2 upstream pulls
// per call), /api/neighborhood (feed + watch), /api/official-alerts
// (NWS/USGS proxies), /api/ai (area-brief + compose-feedback — billed
// AI calls), /api/auth/anonymous (unbounded User row creation —
// special-cased lower since each call writes to Postgres).
// /api/safety used to live in SKIP_PREFIXES on the theory that every
// safety route required auth — but by-coordinates, tips, and trends
// are PUBLIC routes that hammer upstream police APIs. Now in LIMITS.
const LIMITS: Array<{ prefix: string; cap: number }> = [
  { prefix: "/api/auth/anonymous", cap: 5 },   // unbounded User row creation
  // v106 (security audit) — login/register were SKIPPED on the theory they had
  // "their own per-IP authLimiter", but that limiter lives only on the Express
  // API; the Vercel web deployment serves these Next routes with NO throttle,
  // leaving password brute-force / credential-stuffing / account-creation spam
  // unbounded. Longest-prefix match means these only cap login/register — the
  // high-frequency /api/auth/me session check and /anonymous stay as-is.
  { prefix: "/api/auth/login",     cap: 10 },  // brute-force / credential-stuffing guard
  { prefix: "/api/auth/register",  cap: 6 },   // account-creation spam guard
  // fix(audit pentest-authn-6): cap forgot-password (reset-email spam) and
  // reset-password (single-use-token brute-force).
  { prefix: "/api/auth/forgot-password", cap: 5 },
  { prefix: "/api/auth/reset-password",  cap: 10 },
  // v47 bump 5 → 40. The original cap of 5/min was set before the
  // Redis cache landed on Railway (v16, v38). Now ~90% of /api/ai/
  // calls are cache hits with no LLM cost — the cap was throttling
  // legitimate users navigating 2-3 neighborhood pages (area-brief
  // + incident-summary + per-row incident-explain) and surfacing as
  // "Could not generate a brief right now" everywhere. 40/min still
  // bounds the worst-case cache-miss + Groq cost (well under the
  // free-tier 14,400 rpd cap).
  { prefix: "/api/ai/",            cap: 40 },
  { prefix: "/api/assistant",      cap: 10 },  // AI streaming — most expensive
  { prefix: "/api/safety/",        cap: 30 },  // by-coordinates / tips / trends
  { prefix: "/api/route",          cap: 30 },  // safe-route planner (DB + 2 upstream)
  { prefix: "/api/neighborhood",   cap: 30 },  // feed + watch
  { prefix: "/api/official-alerts", cap: 30 }, // NWS/USGS proxies
  { prefix: "/api/coverage",       cap: 30 },
  { prefix: "/api/community",      cap: 30 },
  { prefix: "/api/news",           cap: 30 },
  { prefix: "/api/safezone/",      cap: 60 },
  { prefix: "/api/crime-data/",    cap: 60 },
  { prefix: "/api/geo/",           cap: 60 },
  // fix(audit pentest-ratelimit-share-token / pentest-share-1): the public
  // token-in-URL endpoints had NO rate limit, so an attacker could brute-force
  // share / confirm tokens unbounded from one IP. A legitimate recipient opens
  // the link a handful of times; 20/min/IP is generous for that while making
  // enumeration (the tokens are 20-24 random bytes, already astronomically large
  // a space) economically pointless. Pairs with the base64url shape guard added
  // to both routes in PR #19.
  { prefix: "/api/share/",         cap: 20 },
  { prefix: "/api/contacts/confirm/", cap: 20 },
];

// Path prefixes that are NEVER rate-limited (auth-protected by their
// own session check, or token-issued bootstrap flows that need to
// burst). /api/auth/ remains here for register/login/me; the
// anonymous-bootstrap sub-path is special-cased in LIMITS above and
// the longest-prefix match in pickLimit() ensures it wins.
// /api/account/* and /api/diag/* are session-protected (account) or
// CRON_SECRET-protected (diag) — explicit skip beats relying on the
// "not in LIMITS" fallthrough.
// v96 — documentation-only: the rate-limit table below uses prefix
// matching against LIMITS, not an explicit skip list, but the prefixes
// in this comment are the authoritative reference for "routes the
// middleware intentionally does NOT rate-limit". Kept as a comment so
// the audit trail survives without an unused export.
//
// SKIP_PREFIXES = [
//   "/api/cron/",       // CRON_SECRET-gated
//   "/api/auth/me",     // session-check; high-frequency, low-risk (read-only)
//   // NOTE: /api/auth/login + /register + /anonymous ARE rate-limited above —
//   // the old "has its own per-IP authLimiter" claim was Express-only and did
//   // not cover this Vercel web surface (v106 security audit).
//   "/api/account/",    // authenticated, already per-user
//   "/api/diag/",       // CRON_SECRET-gated diagnostics
//   "/api/preferences/",// authenticated
//   "/api/moderation/", // moderator-only
//   "/api/share/",      // token-only access
//   "/api/contacts/",   // authenticated
// ]

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

  // Per-request nonce + CSP for ALL routes (see buildCsp above).
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce);

  // Non-API routes: propagate the nonce to Next via a request header (so it
  // nonces its own scripts + next/script tags) and set the CSP on the response.
  if (!pathname.startsWith("/api/")) {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("content-security-policy", csp);
    return applyCsp(NextResponse.next({ request: { headers: requestHeaders } }), csp);
  }

  // Resolve the LIMIT first so a specific sub-path (e.g.
  // /api/auth/anonymous) can override a broader SKIP_PREFIXES entry
  // (/api/auth/). Without this ordering, /api/auth/anonymous would
  // be silently exempted by the /api/auth/ skip and an attacker
  // could create unbounded User rows. When no LIMIT matches, we
  // fall through to SKIP_PREFIXES, which documents the routes that
  // are intentionally not rate-limited (auth-gated, token-issued,
  // or cron-secret-gated).
  const cap = pickLimit(pathname);
  if (cap == null) return applyCsp(NextResponse.next(), csp);

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
    return applyCsp(new NextResponse(
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
    ), csp);
  }

  // Pass through with rate-limit headers so clients can self-throttle.
  const res = NextResponse.next();
  res.headers.set("X-RateLimit-Limit", String(cap));
  res.headers.set("X-RateLimit-Remaining", String(Math.max(0, cap - bucket.count)));
  res.headers.set("X-RateLimit-Reset", String(Math.ceil((bucket.windowStart + WINDOW_MS) / 1000)));
  return applyCsp(res, csp);
}

// Run on all routes EXCEPT Next's static assets / image optimizer / favicon,
// so the per-request CSP + nonce reaches pages (the rate-limiter still only
// acts on /api/*). Mirrors Next's recommended nonce-middleware matcher.
export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|sw.js|robots.txt|sitemap.xml).*)",
    },
  ],
};
