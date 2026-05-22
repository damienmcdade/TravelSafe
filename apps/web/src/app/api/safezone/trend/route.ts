import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import {
  getTrendForArea,
  getCitywideTrend,
} from "@/server/services/watch/trend-feed";

/// Accepts ?city=<slug> (citywide aggregate, the page's default state) OR
/// ?area=<slug>&label=<label> (drill-down to one neighborhood). Both paths
/// return the same TrendResponse shape, so the client renders either with
/// one component.
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

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
};

export const GET = wrap(async (req: NextRequest) => {
  const { city, area, label } = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  if (city) return NextResponse.json(await getCitywideTrend(city), { headers: CACHE_HEADERS });
  return NextResponse.json(await getTrendForArea(area!, label ?? area!), { headers: CACHE_HEADERS });
});
