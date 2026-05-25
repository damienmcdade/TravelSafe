import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/server/lib/rate-limit";
import { allKnownAreas } from "@/server/services/geo/lookup";
import { cityBySlug } from "@/server/services/crime-data/cities";
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
  const citySlug = req.nextUrl.searchParams.get("city");
  if (citySlug) {
    const city = cityBySlug(citySlug);
    if (!city) {
      return NextResponse.json({ areas: [] }, { status: 200, headers: STABLE_CACHE_HEADERS });
    }
    const areas = await city.discover().catch(() => []);
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
}
