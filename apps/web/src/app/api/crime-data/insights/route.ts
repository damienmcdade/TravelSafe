import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap, HttpError } from "@/server/lib/http";
import { rateLimit } from "@/server/lib/rate-limit";
import { getAreaInsights, getCitywideInsights } from "@/server/services/crime-data/insights";
import { withWarmingTimeout } from "@/server/lib/warming-timeout";

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
  "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=900",
};

export const GET = wrap(async (req: NextRequest) => {
  const limited = rateLimit(req, { scope: "crime-data" });
  if (limited) return limited;
  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  // fix(deploy/sync-check flake): insights was the one heavy crime-data route NOT
  // wrapped, so a cold compute on a big city (NYC ~200k rows) could blow the
  // function ceiling and time out with NO status (the sync-check saw vercel=0 vs
  // railway=200). Wrap both branches in withWarmingTimeout for a retryable 503.
  if (q.city) return withWarmingTimeout(getCitywideInsights(q.city), (v) => NextResponse.json(v, { headers: CACHE_HEADERS }));
  const area = q.neighborhood ?? q.jurisdiction;
  if (!area) throw new HttpError(400, "area_or_city_required");
  return withWarmingTimeout(getAreaInsights(area), (v) => NextResponse.json(v, { headers: CACHE_HEADERS }));
});
