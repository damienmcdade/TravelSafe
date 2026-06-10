import { NextResponse, type NextRequest } from "next/server";
import { wrap, HttpError } from "@/server/lib/http";
import { getNews } from "@/server/services/news/google-news";
import { cityForArea, cityBySlug } from "@/server/services/crime-data/cities";
import { anonPostLimited } from "@/server/lib/rate-limit";

export const dynamic = "force-dynamic";

// fix(audit news-proxy-no-ratelimit): this public proxy fans out to Google
// News RSS on every call. The edge middleware caps it per-instance, but that's
// per-Vercel-instance and resets on cold start — add the same cross-instance
// (Redis/DB-backed) per-IP gate the community routes use so a single IP can't
// hammer the upstream feed. 30/min burst + 600/day is generous for humans +
// search crawlers; fails OPEN if the limiter infra is down.
const NEWS_BURST_LIMIT = 30;
const NEWS_BURST_WINDOW_SEC = 60;
const NEWS_DAILY_LIMIT = 600;

// Strip a city's own slug prefix from neighborhood slugs so the Google News
// query reads naturally (e.g. "la-hollywood" → "Hollywood Los Angeles ...").
function denormalize(slug: string): string {
  return slug.replace(/^(la|sf|sd|chi|ny|sea|bos|phl|dc|den|det|oak|cin|nola|br|cam|dal|clt|nas|mpls|cle|moco|lv|bzi|buf|tuc|kc|sp|pgh)-/, "").replace(/-/g, " ").replace(/\bcluster\s*\d+\s*/, "");
}

export const GET = wrap(async (req: NextRequest) => {
  if (await anonPostLimited(req, {
    burstLimit: NEWS_BURST_LIMIT,
    burstWindowSec: NEWS_BURST_WINDOW_SEC,
    dailyLimit: NEWS_DAILY_LIMIT,
    scope: "news",
  })) {
    throw new HttpError(429, "rate_limited");
  }
  const area = req.nextUrl.searchParams.get("area");
  const cityParam = req.nextUrl.searchParams.get("city");

  // Resolve which city the query refers to. Order of preference:
  //   1. ?city= param (explicit selector)
  //   2. area slug prefix (la- → Los Angeles, sf- → San Francisco)
  //   3. default to San Diego
  let cityLabel = "San Diego";
  if (cityParam) {
    cityLabel = cityBySlug(cityParam)?.label ?? cityLabel;
  } else if (area) {
    cityLabel = cityForArea(area).label;
  }

  const q = area
    ? `${denormalize(area)} ${cityLabel} crime OR safety OR police`
    : `${cityLabel} crime OR safety OR police`;

  // Time window for the Google News search (`when:Nd` operator).
  // Defaults to 30 days for the Neighborhood Awareness card; values
  // are clamped server-side in getNews().
  const windowDaysRaw = req.nextUrl.searchParams.get("windowDays");
  const windowDays = windowDaysRaw && Number.isFinite(Number(windowDaysRaw))
    ? Number(windowDaysRaw)
    : 30;

  const items = await getNews(q, windowDays);
  return NextResponse.json({
    source: `Google News (${cityLabel} safety query, last ${windowDays}d)`,
    query: q,
    windowDays,
    items,
    disclaimer: "Headlines aggregated from Google News. Click through to read the original article at the source.",
  });
});
