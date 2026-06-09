import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { rateLimit } from "@/server/lib/rate-limit";
import { tryProxy } from "@/server/lib/proxy-to-api";
import {
  getSafetyScore,
  getCitywideSafetyScore,
} from "@/server/services/watch/safety-score";
import { humanizeArea, cityBySlug } from "@travelsafe/crime-data/cities";

/// Two modes share this route:
///   ?city=<slug>                 → citywide aggregate vs FBI national rate
///   ?area=<slug>&label=<label>   → specific neighborhood vs FBI national rate
/// Exactly one of city or area must be present. Both paths return the
/// same SafetyScoreResponse shape so the client can render either with
/// the same component without branching on URL parameters.
const Query = z.object({
  city:  z.string().min(1).max(120).optional(),
  area:  z.string().min(1).max(120).optional(),
  label: z.string().min(1).max(120).optional(),
}).refine((q) => Boolean(q.city) !== Boolean(q.area), {
  message: "Pass exactly one of `city` or `area`.",
});

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

// Edge cache for 5 min (matches the upstream adapter's cache TTL — there's
// no fresher data to serve than this). stale-while-revalidate of 15 min
// lets the Vercel edge serve a stale response instantly while it
// revalidates in the background — first cold visit pays the upstream
// fetch, every subsequent user inside the window hits cache.
const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=900",
};
// fix(perf safety-score-no-cold-cache-latch): a PROVISIONAL citywide score
// (dataConfidence !== "high") is exactly the one that improves once the tiered
// adapter warms — caching it for 5 min would latch the partial answer (the same
// class of cold-latch the LV/Houston window-widen fix addressed at the adapter
// level). Serve provisional citywide scores no-store so the next request
// recomputes against the now-warm cache; HIGH-confidence scores cache normally.
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export const GET = wrap(async (req: NextRequest) => {
  const limited = rateLimit(req, { scope: "safezone" });
  if (limited) return limited;
  // v37: prefer Railway when API_BASE_URL is set so all four
  // safezone + crime-data endpoints run on the Railway long-lived
  // process (shared adapter cache → fewer upstream fetches).
  // Falls through to the local implementation on any upstream
  // error so a Railway hiccup never blocks the user.
  const proxied = await tryProxy(req, "/safezone/safety-score");
  if (proxied) return proxied.response;

  const { city, area, label } = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  if (city) {
    // fix(audit safety-unsupported-city-500-5): an unknown city slug threw deep
    // in the composer and surfaced as a 500. Validate up front and return the
    // documented 404 city_not_supported; reserve 500 for genuine errors.
    if (!cityBySlug(city)) {
      return NextResponse.json({ error: "city_not_supported" }, { status: 404 });
    }
    const score = await getCitywideSafetyScore(city);
    const headers = score?.dataConfidence === "high" ? CACHE_HEADERS : NO_STORE_HEADERS;
    return NextResponse.json(score, { headers });
  }
  return NextResponse.json(
    await getSafetyScore(area!, label && label !== area ? label : humanizeArea(area!)),
    { headers: CACHE_HEADERS },
  );
});
