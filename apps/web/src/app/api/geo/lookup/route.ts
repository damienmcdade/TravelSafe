import { NextResponse, type NextRequest } from "next/server";
import { wrap, HttpError } from "@/server/lib/http";
import { rateLimit } from "@/server/lib/rate-limit";
import { lookupLocation } from "@/server/services/geo/lookup";
import { nearestArea } from "@/server/services/crime-data/neighborhoods";

export const dynamic = "force-dynamic";

// v52 — now accepts EITHER `?q=<text>` (geocode + snap to nearest
// supported area) OR `?lat=<float>&lng=<float>` (skip geocoding, snap
// the coordinates directly to the nearest area centroid). The
// lat/lng path is used by the Safe Route "Use my location" button so
// we don't waste a Nominatim round-trip when the browser already
// gave us coordinates.
export const GET = wrap(async (req: NextRequest) => {
  const limited = rateLimit(req, { scope: "geo" });
  if (limited) return limited;
  const sp = req.nextUrl.searchParams;
  const latStr = sp.get("lat");
  const lngStr = sp.get("lng");
  if (latStr != null && lngStr != null) {
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new HttpError(400, "invalid_coordinates", "lat and lng must be valid numbers");
    }
    const area = nearestArea({ lat, lng });
    if (!area) return NextResponse.json({ error: "no_match" }, { status: 404 });
    return NextResponse.json({
      area,
      matchedVia: "geocode" as const,
      rawQuery: `${lat.toFixed(4)},${lng.toFixed(4)}`,
    });
  }

  const q = sp.get("q") ?? "";
  if (!q.trim()) throw new HttpError(400, "missing_query", "Pass either `q` or `lat`+`lng`");
  if (q.length > 200) throw new HttpError(400, "query_too_long");
  const result = await lookupLocation(q);
  if (!result) return NextResponse.json({ error: "no_match" }, { status: 404 });
  return NextResponse.json(result);
});
