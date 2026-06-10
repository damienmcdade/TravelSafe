import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/server/lib/rate-limit";
import { tryProxy } from "@/server/lib/proxy-to-api";
import { allKnownAreas } from "@/server/services/geo/lookup";
import { cityBySlug } from "@/server/services/crime-data/cities";
import { normalizeAreaLabel } from "@travelsafe/crime-data/cities";
import { getDiscoveredAreasStale as sdpdStale } from "@travelsafe/crime-data/adapters/sdpd-nibrs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Neighborhood lists are extremely stable — they only change when a city's
// open-data feed adds or renames a beat. 1-hour edge cache + 24-hour SWR
// makes the wheel show up instantly for every repeat visitor.
const STABLE_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};

/// /api/geo/areas — returns all neighborhoods we track across every city.
///
/// Two response shapes:
///   - Without `?city=`: bare `KnownArea[]` (back-compat for legacy callers)
///   - With `?city=<slug>`: `{ areas, stale?, staleMessage? }` so the
///     client can render a "live feed warming up" hint when an adapter
///     is serving last-known-good data instead of a fresh pull.
///
/// The per-city short-path also fans one adapter discovery instead of 29
/// (the unbounded all-cities call is cold-slow because the slowest
/// adapter dominates), so this is the preferred path for the wheel.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { scope: "geo" });
  if (limited) return limited;
  // fix(audit geo-areas-unhandled-500): the handler body was not wrapped, so an
  // upstream/proxy/adapter throw surfaced as an unhandled 500. The wheel/picker
  // clients tolerate an empty list (they render "no neighborhoods" gracefully),
  // so degrade to `{ areas: [] }` with 200 — matching the existing unknown-city
  // fallback shape — instead of a hard error.
  try {
  // v64 — proxy to Railway. Vercel logs showed recurring 504 timeouts
  // on /api/geo/areas because city.discover() on a cold Vercel instance
  // can do a full adapter fetch (5min+ for Cleveland). Railway's warm
  // cache returns the same data in ms. Fallback to local on Railway
  // hiccup so this never blocks a user.
  const proxied = await tryProxy(req, "/geo/areas");
  if (proxied) return proxied.response;
  const citySlug = req.nextUrl.searchParams.get("city");
  if (citySlug) {
    const city = cityBySlug(citySlug);
    if (!city) {
      return NextResponse.json({ areas: [] }, { status: 200, headers: STABLE_CACHE_HEADERS });
    }
    // Use the display-only primary list when a city defines one (e.g. Virginia
    // Beach collapses 961 micro-subdivisions to ~real civic areas for the picker);
    // the full discover() still feeds the citywide grade. fix(audit vb-over-fragmentation).
    const discovered = await (city.discoverPrimary ?? city.discover)().catch(() => []);
    // fix(labels-all-caps): mirror the Railway choke point so the local
    // fallback path (Railway hiccup) also serves clean Title-Case labels.
    const areas = discovered.map((a) => ({ ...a, label: normalizeAreaLabel(a.label) }));
    // Per-adapter staleness. Today only SDPD has a last-known-good
    // fallback wired in (because seshat.datasd.org has intermittently
    // rejected Vercel IPs); generalize as other adapters get the same
    // treatment.
    let stale = false;
    let staleMessage: string | undefined;
    if (citySlug === "san-diego" && sdpdStale()) {
      stale = true;
      // Accuracy: the SDPD upstream periodically rejects Vercel IPs, so a
      // fresh adapter pull can come back empty. We fall back to the last
      // successful pull. The earlier copy ("warming up") implied an
      // initialization state; the rewrite below names the actual cause
      // so users understand the data is cached, not loading.
      staleMessage = "The San Diego police feed didn't return new data this request, so we're showing the last successful neighborhood pull. Scores and incidents below may be a few minutes behind.";
    }
    return NextResponse.json({ areas, stale, staleMessage }, { headers: STABLE_CACHE_HEADERS });
  }
  return NextResponse.json(await allKnownAreas(), { headers: STABLE_CACHE_HEADERS });
  } catch (err) {
    console.error("[geo/areas] degraded to empty list:", (err as Error)?.message ?? err);
    // 200 with an empty list keeps the wheel/picker clients functional (they
    // render an empty state) instead of stranding them on a 500.
    return NextResponse.json({ areas: [] }, { status: 200, headers: STABLE_CACHE_HEADERS });
  }
}
