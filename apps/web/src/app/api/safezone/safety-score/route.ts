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

export const GET = wrap(async (req: NextRequest) => {
  const { city, area, label } = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  if (city) return NextResponse.json(await getCitywideSafetyScore(city));
  return NextResponse.json(await getSafetyScore(area!, label ?? area!));
});
