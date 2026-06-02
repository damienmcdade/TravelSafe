import { NextResponse, type NextRequest } from "next/server";
import { wrap, HttpError } from "@/server/lib/http";
import { rateLimit } from "@/server/lib/rate-limit";
import { tryProxy } from "@/server/lib/proxy-to-api";
import { lookupLocation } from "@/server/services/geo/lookup";
import { nearestArea } from "@/server/services/crime-data/neighborhoods";
import { parseCoordPair } from "@/server/lib/coords";

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
  // v87 — proxy to Railway for hot-cache lookups. The local
  // lookupLocation path fans out all 31 adapter discover() calls
  // when fuzzy/nearest-area is needed, which routinely exceeds
  // Vercel's 60s function timeout on cold containers (audit caught
  // /api/geo/lookup hanging 94s while the Railway equivalent
  // returned in 660ms). Falls through to local on Railway error.
  const proxied = await tryProxy(req, "/geo/lookup");
  if (proxied) return proxied.response;
  const sp = req.nextUrl.searchParams;
  const latStr = sp.get("lat");
  const lngStr = sp.get("lng");
  if (latStr != null && lngStr != null) {
    // fix(audit loc-coords-2): range-validate, not just finite-check, so an
    // out-of-range pair can't snap to a bogus nearest area.
    const pair = parseCoordPair(latStr, lngStr);
    if (!pair) {
      throw new HttpError(400, "invalid_coordinates", "lat must be -90..90 and lng -180..180");
    }
    const { lat, lng } = pair;
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
  // v95p15 — optional ?city= so Nominatim + fuzzy match scope to the
  // user's selected city. Without it, the lookup falls back to the
  // legacy SD-only scope (back-compat).
  const citySlug = sp.get("city") || undefined;
  const result = await lookupLocation(q, citySlug);
  if (!result) return NextResponse.json({ error: "no_match" }, { status: 404 });
  return NextResponse.json(result);
});
