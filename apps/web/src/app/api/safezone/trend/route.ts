import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { rateLimit } from "@/server/lib/rate-limit";
import { tryProxy } from "@/server/lib/proxy-to-api";
import {
  getTrendForArea,
  getCitywideTrend,
} from "@/server/services/watch/trend-feed";

/// Accepts ?city=<slug> (citywide aggregate, the page's default state) OR
/// ?area=<slug>&label=<label> (drill-down to one neighborhood). Both paths
/// return the same TrendResponse shape, so the client renders either with
/// one component. Optional ?days=<7|14|30|90> controls the window size;
/// defaults to 30 to preserve back-compat.
const Query = z.object({
  city:  z.string().min(1).max(120).optional(),
  area:  z.string().min(1).max(120).optional(),
  label: z.string().min(1).max(120).optional(),
  days:  z.coerce.number().int().min(1).max(180).optional(),
  // v99 — cap the dispatch-bullet list. Callers that only need the
  // freshness/summary (DataFreshnessBanner) pass bullets=0 to skip the
  // ~760 KB list. Omitted = full list (back-compat).
  bullets: z.coerce.number().int().min(0).max(5000).optional(),
}).refine((q) => Boolean(q.city) !== Boolean(q.area), {
  message: "Pass exactly one of `city` or `area`.",
});

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=900",
};

export const GET = wrap(async (req: NextRequest) => {
  const limited = rateLimit(req, { scope: "safezone" });
  if (limited) return limited;
  const proxied = await tryProxy(req, "/safezone/trend");
  if (proxied) return proxied.response;

  const { city, area, label, days, bullets } = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  if (city) return NextResponse.json(await getCitywideTrend(city, { windowDays: days, bulletLimit: bullets }), { headers: CACHE_HEADERS });
  return NextResponse.json(await getTrendForArea(area!, label ?? area!, { windowDays: days, bulletLimit: bullets }), { headers: CACHE_HEADERS });
});
