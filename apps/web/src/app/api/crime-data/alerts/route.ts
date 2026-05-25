import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap, HttpError } from "@/server/lib/http";
import { rateLimit } from "@/server/lib/rate-limit";
import { crimeData } from "@/server/services/crime-data";
import { listKnownAreas, nearestArea, type KnownArea } from "@/server/services/crime-data/neighborhoods";
import { cityFromLatLng, cityForArea, nearestCityByCentroid } from "@/server/services/crime-data/cities";

const Query = z.object({
  neighborhood: z.string().optional(),
  jurisdiction: z.string().optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
});

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/// Resolve a (lat,lng) to a KnownArea. Two-pass:
///   1. If the point is inside a city's bbox, use that city directly.
///   2. Otherwise fall back to nearestCityByCentroid — a user just
///      outside a city's bbox (suburb, neighboring township, the next
///      county over) should still route to that obvious-closest
///      tracked city instead of seeing "outside coverage". Only when
///      the closest tracked city is more than 100km from the point
///      do we treat them as outside coverage entirely.
///
/// Once a city is picked, we walk that city's full discovered area
/// list and pick the nearest centroid. No hard cap — if the user's
/// city has been picked, ANY area in it is a meaningful result
/// (better than 404). We expose how far the picked area is so the
/// caller can show "we routed you to LA Downtown, 18 km from your
/// location" when the match isn't exact.
async function resolveByLatLng(lat: number, lng: number): Promise<{
  area: KnownArea;
  cityLabel: string;
  citySlug: string;
  /// True when the user's point fell OUTSIDE the picked city's bbox
  /// and we fell back to nearest-city-by-centroid. Lets the UI show
  /// a "routed to <closest tracked city>" hint instead of pretending
  /// the user is in that city.
  offBbox: boolean;
  /// Great-circle distance from the user's point to the picked
  /// area's centroid, in km.
  distanceKm: number;
} | null> {
  let city = cityFromLatLng({ lat, lng });
  let offBbox = false;
  if (!city) {
    const near = nearestCityByCentroid({ lat, lng });
    // 100km cap: a user in Honolulu shouldn't get routed to LA. If
    // the nearest tracked city is more than 100km from the point,
    // we're genuinely outside meaningful coverage.
    if (!near || near.km > 100) return null;
    city = near.city;
    offBbox = true;
  }
  const all = await listKnownAreas();
  const candidates = all.filter((a) => a.jurisdiction.toLowerCase() === city!.label.toLowerCase());
  if (candidates.length === 0) return null;
  let best: { area: KnownArea; km: number } | null = null;
  for (const a of candidates) {
    const km = haversineKm({ lat, lng }, a.centroid);
    if (!best || km < best.km) best = { area: a, km };
  }
  if (!best) return null;
  return { area: best.area, cityLabel: city.label, citySlug: city.slug, offBbox, distanceKm: best.km };
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Slug-based lookups are shared cache keys (everyone querying "loop" hits
// the same entry). Lat/lng-based lookups skip the shared edge cache because
// every coordinate is effectively unique.
const SHARED_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
};
const PRIVATE_CACHE_HEADERS = {
  "Cache-Control": "private, max-age=60",
};

export const GET = wrap(async (req: NextRequest) => {
  const limited = rateLimit(req, { scope: "crime-data" });
  if (limited) return limited;
  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));

  if (q.neighborhood || q.jurisdiction) {
    const slug = (q.neighborhood ?? q.jurisdiction)!;
    const city = cityForArea(slug);
    return NextResponse.json({
      area: slug,
      label: slug,
      city: city.label,
      alerts: await crimeData.getAreaAlerts(slug, { limit: q.limit }),
    }, { headers: SHARED_CACHE_HEADERS });
  }

  if (q.lat != null && q.lng != null) {
    const resolved = await resolveByLatLng(q.lat, q.lng);
    if (!resolved) {
      const fallback = nearestArea({ lat: q.lat, lng: q.lng });
      if (fallback) {
        return NextResponse.json({
          area: fallback.slug,
          label: fallback.label,
          city: fallback.jurisdiction,
          citySlug: null,
          offBbox: true,
          distanceKm: null,
          alerts: await crimeData.getAreaAlerts(fallback.slug, { limit: q.limit }),
        }, { headers: PRIVATE_CACHE_HEADERS });
      }
      throw new HttpError(
        404,
        "outside_coverage",
        "Your location is outside the cities CommunitySafe currently covers. Pick a city manually from the wheel to browse its data.",
      );
    }
    return NextResponse.json({
      area: resolved.area.slug,
      label: resolved.area.label,
      city: resolved.cityLabel,
      citySlug: resolved.citySlug,
      offBbox: resolved.offBbox,
      distanceKm: resolved.distanceKm,
      alerts: await crimeData.getAreaAlerts(resolved.area.slug, { limit: q.limit }),
    }, { headers: PRIVATE_CACHE_HEADERS });
  }

  throw new HttpError(400, "area_required");
});
