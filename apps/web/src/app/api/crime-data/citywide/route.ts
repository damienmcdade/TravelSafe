import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { rateLimit } from "@/server/lib/rate-limit";
import { tryProxy } from "@/server/lib/proxy-to-api";
import { crimeData } from "@/server/services/crime-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=900",
};

export const GET = wrap(async (req: NextRequest) => {
  const limited = rateLimit(req, { scope: "crime-data" });
  if (limited) return limited;
  // v62 — Railway's warm-worker keeps the adapter cache hot on a 4-min
  // cycle (well inside the 5-min TTL); Vercel's per-instance adapter
  // cache only warms on user requests, so the first user after a cold
  // start pays the full upstream-fetch cost. Route through Railway when
  // API_BASE_URL is configured; tryProxy falls back to local on any
  // Railway hiccup so this never blocks a user.
  const proxied = await tryProxy(req, "/crime-data/citywide");
  if (proxied) return proxied.response;
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
