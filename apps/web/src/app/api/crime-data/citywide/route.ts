import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { rateLimit } from "@/server/lib/rate-limit";
import { crimeData } from "@/server/services/crime-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
};

export const GET = wrap(async (req: NextRequest) => {
  const limited = rateLimit(req, { scope: "crime-data" });
  if (limited) return limited;
  const city = req.nextUrl.searchParams.get("city") ?? "san-diego";
  const offense = req.nextUrl.searchParams.get("offense") ?? undefined;
  // windowDays narrows the in-window incident set so the Crime Chart's
  // interval picker (7d / 30d / 90d / 365d) returns aggregates that
  // match the chosen window. Omitted → unfiltered (legacy behavior).
  const windowDaysRaw = req.nextUrl.searchParams.get("windowDays");
  const windowDays = windowDaysRaw && Number.isFinite(Number(windowDaysRaw)) && Number(windowDaysRaw) > 0
    ? Number(windowDaysRaw)
    : undefined;
  return NextResponse.json(await crimeData.getCitywide(city, { offense, windowDays }), { headers: CACHE_HEADERS });
});
