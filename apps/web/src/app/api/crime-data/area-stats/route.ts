import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap, HttpError } from "@/server/lib/http";
import { rateLimit } from "@/server/lib/rate-limit";
import { crimeData } from "@/server/services/crime-data";
import { nearestArea } from "@/server/services/crime-data/neighborhoods";

/// Modes:
///   ?city=<slug>                      → citywide totals + provenance
///   ?neighborhood=<slug>              → area-level stats
///   ?lat=…&lng=…                      → resolve to nearest area, then per-area
/// `jurisdiction` is a legacy alias for `neighborhood`. Both citywide and
/// per-area return the same AreaStats shape so consumers render with one
/// branch.
const Query = z.object({
  city: z.string().min(1).max(120).optional(),
  neighborhood: z.string().optional(),
  jurisdiction: z.string().optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
});

export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
};

export const GET = wrap(async (req: NextRequest) => {
  const limited = rateLimit(req, { scope: "crime-data" });
  if (limited) return limited;
  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  if (q.city) return NextResponse.json(await crimeData.getCitywideAreaStats(q.city), { headers: CACHE_HEADERS });
  const area = q.neighborhood ?? q.jurisdiction ?? (q.lat != null && q.lng != null ? nearestArea({ lat: q.lat, lng: q.lng })?.slug ?? null : null);
  if (!area) throw new HttpError(400, "area_or_city_required");
  return NextResponse.json(await crimeData.getAreaStats(area), { headers: CACHE_HEADERS });
});
