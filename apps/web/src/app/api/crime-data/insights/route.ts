import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap, HttpError } from "@/server/lib/http";
import { rateLimit } from "@/server/lib/rate-limit";
import { getAreaInsights, getCitywideInsights } from "@/server/services/crime-data/insights";

/// Two modes share this route:
///   ?city=<slug>                      → citywide 12-week trend aggregate
///   ?neighborhood=<slug>              → specific area's 12-week trend
/// `jurisdiction` is a legacy alias for `neighborhood` (kept for callers
/// that pass it pointing at a real area slug). Both modes return the same
/// AreaInsights shape so the trend graph renders with one branch.
const Query = z.object({
  city: z.string().min(1).max(120).optional(),
  neighborhood: z.string().optional(),
  jurisdiction: z.string().optional(),
});

export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
};

export const GET = wrap(async (req: NextRequest) => {
  const limited = rateLimit(req, { scope: "crime-data" });
  if (limited) return limited;
  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  if (q.city) return NextResponse.json(await getCitywideInsights(q.city), { headers: CACHE_HEADERS });
  const area = q.neighborhood ?? q.jurisdiction;
  if (!area) throw new HttpError(400, "area_or_city_required");
  return NextResponse.json(await getAreaInsights(area), { headers: CACHE_HEADERS });
});
