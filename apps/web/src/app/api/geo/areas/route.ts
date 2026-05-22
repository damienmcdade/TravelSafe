import { NextResponse, type NextRequest } from "next/server";
import { allKnownAreas } from "@/server/services/geo/lookup";
import { cityBySlug } from "@/server/services/crime-data/cities";

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
/// Adds a `?city=<slug>` short-path that scopes the response to ONE city's
/// adapter. The all-cities path is cold-slow (it fans 27 adapter discoveries
/// in parallel; the slowest dominates), and the Neighborhood Watch wheel
/// only ever needs one city's neighborhoods. Scoping turns a 30s cold call
/// into a 2-5s cold call and unblocks the wheel.
export async function GET(req: NextRequest) {
  const citySlug = req.nextUrl.searchParams.get("city");
  if (citySlug) {
    const city = cityBySlug(citySlug);
    if (!city) return NextResponse.json([], { status: 200, headers: STABLE_CACHE_HEADERS });
    const areas = await city.discover().catch(() => []);
    return NextResponse.json(areas, { headers: STABLE_CACHE_HEADERS });
  }
  return NextResponse.json(await allKnownAreas(), { headers: STABLE_CACHE_HEADERS });
}
