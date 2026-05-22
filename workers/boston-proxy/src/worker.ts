// Cloudflare Worker that proxies Boston's CKAN datastore endpoint.
//
// Why this exists: data.boston.gov returns 0 records to TravelSafe's
// Vercel-hosted serverless functions for any limit ≥ 500, despite the same
// requests succeeding in <1.5s from every dev machine. The block is at
// Boston's CDN edge (almost certainly an ASN-level filter on Vercel's IPs);
// no Vercel-side fetch tweak we've tried bypasses it.
//
// Deploying this Worker on Cloudflare's edge gives us an upstream IP that
// data.boston.gov *doesn't* filter. The Worker exposes one endpoint:
//   GET /datastore_search?<original CKAN query params>
// and forwards verbatim to:
//   https://data.boston.gov/api/3/action/datastore_search?<same params>
//
// Response is cached at the Cloudflare edge for 5 minutes, matching our
// server-side adapter TTL, so steady-state traffic almost never hits CKAN.
//
// Free tier (100K req/day) is plenty — each TravelSafe request hits this
// at most twice per 5-minute cache window per region.

interface Env {
  // No required env vars; data.boston.gov is public + unauthenticated.
}

const UPSTREAM_BASE = "https://data.boston.gov/api/3/action/datastore_search";

// Hard allow-list of CKAN parameters we'll forward. Anything else gets dropped
// so the Worker can't be turned into an open proxy for arbitrary URLs.
const ALLOWED_PARAMS = new Set([
  "resource_id",
  "limit",
  "offset",
  "sort",
  "q",
  "filters",
  "fields",
  "plain",
  "language",
]);

export default {
  async fetch(request: Request, _env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      // Permissive CORS so the proxy can also be called from a browser if
      // we ever want to call it client-side.
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }
    if (request.method !== "GET") {
      return jsonError(405, "method_not_allowed");
    }

    const url = new URL(request.url);
    if (url.pathname !== "/" && url.pathname !== "/datastore_search") {
      return jsonError(404, "not_found");
    }

    // Build the upstream URL with only allow-listed params.
    const upstream = new URL(UPSTREAM_BASE);
    for (const [k, v] of url.searchParams.entries()) {
      if (ALLOWED_PARAMS.has(k)) upstream.searchParams.set(k, v);
    }
    if (!upstream.searchParams.get("resource_id")) {
      return jsonError(400, "missing_resource_id");
    }

    // Cloudflare edge cache. Same TTL as the TravelSafe adapter's cache so
    // a fresh adapter pull always sees fresh upstream data within ≤ 5 min.
    const cache = caches.default;
    const cacheKey = new Request(upstream.toString(), { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) {
      const c = new Response(cached.body, cached);
      c.headers.set("X-Proxy-Cache", "HIT");
      return c;
    }

    const upstreamRes = await fetch(upstream.toString(), {
      headers: {
        Accept: "application/json",
        // Generic UA so CKAN treats us like any browser-side caller.
        "User-Agent": "Mozilla/5.0 TravelSafe-Boston-Proxy/0.1",
      },
      // Cloudflare's fetch supports its own cache directives.
      cf: { cacheTtl: 300, cacheEverything: true },
    });

    // Wrap upstream response with our own headers (CORS + cache control)
    // and stash a copy in the edge cache.
    const body = await upstreamRes.arrayBuffer();
    const res = new Response(body, {
      status: upstreamRes.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
        "X-Proxy-Upstream": upstream.host,
        "X-Proxy-Cache": "MISS",
      },
    });
    if (upstreamRes.ok) {
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
    return res;
  },
};

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
