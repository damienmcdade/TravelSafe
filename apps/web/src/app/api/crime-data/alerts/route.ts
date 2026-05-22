import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap, HttpError } from "@/server/lib/http";
import { crimeData } from "@/server/services/crime-data";
import { listKnownAreas, nearestArea, type KnownArea } from "@/server/services/crime-data/neighborhoods";
import { cityFromLatLng, cityForArea } from "@/server/services/crime-data/cities";

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

/// Resolve a (lat,lng) to a KnownArea. The previous implementation used the
/// sync nearestArea(), which silently fell back to a 7-neighborhood hardcoded
/// list on cold function instances — meaning anyone outside that small set
/// (most of LA, all of SF, anywhere in California outside ~7 SD points)
/// got a 400. We now:
///   1. Identify the city by bounding box.
///   2. Pull that city's full discovered neighborhood list.
///   3. Pick the nearest by great-circle distance, capped at 30km.
async function resolveByLatLng(lat: number, lng: number): Promise<{ area: KnownArea; cityLabel: string } | null> {
  const city = cityFromLatLng({ lat, lng });
  if (!city) return null;
  const all = await listKnownAreas();
  const candidates = all.filter((a) => a.jurisdiction.toLowerCase() === city.label.toLowerCase());
  let best: { area: KnownArea; km: number } | null = null;
  for (const a of candidates) {
    const km = haversineKm({ lat, lng }, a.centroid);
    if (!best || km < best.km) best = { area: a, km };
  }
  return best && best.km < 30 ? { area: best.area, cityLabel: city.label } : null;
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
          alerts: await crimeData.getAreaAlerts(fallback.slug, { limit: q.limit }),
        }, { headers: PRIVATE_CACHE_HEADERS });
      }
      throw new HttpError(404, "outside_coverage", "Your location is outside the cities TravelSafe currently covers (San Diego, Los Angeles, San Francisco).");
    }
    return NextResponse.json({
      area: resolved.area.slug,
      label: resolved.area.label,
      city: resolved.cityLabel,
      alerts: await crimeData.getAreaAlerts(resolved.area.slug, { limit: q.limit }),
    }, { headers: PRIVATE_CACHE_HEADERS });
  }

  throw new HttpError(400, "area_required");
});
