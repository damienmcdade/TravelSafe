import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import {
  getSafetyScore,
  getCitywideSafetyScore,
} from "@/server/services/watch/safety-score";

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
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
};

export const GET = wrap(async (req: NextRequest) => {
  const { city, area, label } = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  if (city) return NextResponse.json(await getCitywideSafetyScore(city), { headers: CACHE_HEADERS });
  return NextResponse.json(await getSafetyScore(area!, label ?? area!), { headers: CACHE_HEADERS });
});
