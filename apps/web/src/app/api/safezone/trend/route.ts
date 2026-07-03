import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { rateLimit } from "@/server/lib/rate-limit";
import { tryProxy } from "@/server/lib/proxy-to-api";
import { canonicalCitySlug } from "@/server/lib/city-alias";
import {
  getTrendForArea,
  getCitywideTrend,
} from "@/server/services/watch/trend-feed";
import { withWarmingTimeout } from "@/server/lib/warming-timeout";

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
  // ~760 KB list; the time-of-day card passes bullets=1000.
  // fix(audit perf-compute-4): an OMITTED `bullets` used to mean "the full
  // ~5000-bullet / ~760 KB list" — a footgun for any caller that forgets it.
  // The default is now DEFAULT_BULLETS (below); a caller that genuinely needs
  // the whole list opts IN with bullets=5000. All in-app UI callers already pass
  // an explicit value, so this only tightens the implicit default.
  bullets: z.coerce.number().int().min(0).max(5000).optional(),
}).refine((q) => Boolean(q.city) !== Boolean(q.area), {
  message: "Pass exactly one of `city` or `area`.",
});

// Default dispatch-bullet cap when a caller omits `bullets`. Comfortably covers
// the trend-display + time-of-day needs (~hundreds) while bounding the payload
// to ~tens of KB instead of ~760 KB.
const DEFAULT_BULLETS = 500;

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=900",
};

export const GET = wrap(async (req: NextRequest) => {
  const limited = rateLimit(req, { scope: "safezone" });
  if (limited) return limited;
  // Canonicalize label-derived city slugs ("new-york-city" → "new-york")
  // BEFORE the proxy so Railway receives the registry slug too.
  const rawCity = req.nextUrl.searchParams.get("city");
  if (rawCity) {
    const canon = canonicalCitySlug(rawCity);
    if (canon !== rawCity) req.nextUrl.searchParams.set("city", canon);
  }
  const proxied = await tryProxy(req, "/safezone/trend");
  if (proxied) return proxied.response;

  const { city, area, label, days, bullets } = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  // fix(audit perf-compute-4): omitted → DEFAULT_BULLETS, not the full list.
  const bulletLimit = bullets ?? DEFAULT_BULLETS;
  // fix(audit perf-compute-6): wrap in withWarmingTimeout like the other heavy
  // crime-data routes — a cold trend compute on a big city can otherwise blow the
  // 60s function ceiling and return a hard 504. This races the compose against a
  // sub-ceiling deadline and returns a retryable 503 warming_up instead.
  if (city) return withWarmingTimeout(getCitywideTrend(city, { windowDays: days, bulletLimit }), (v) => NextResponse.json(v, { headers: CACHE_HEADERS }));
  return withWarmingTimeout(getTrendForArea(area!, label ?? area!, { windowDays: days, bulletLimit }), (v) => NextResponse.json(v, { headers: CACHE_HEADERS }));
});
