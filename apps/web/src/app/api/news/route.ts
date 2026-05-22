import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { getNews } from "@/server/services/news/google-news";
import { cityForArea, cityBySlug } from "@/server/services/crime-data/cities";

export const dynamic = "force-dynamic";

// Strip a city's own slug prefix from neighborhood slugs so the Google News
// query reads naturally (e.g. "la-hollywood" → "Hollywood Los Angeles ...").
function denormalize(slug: string): string {
  return slug.replace(/^(la|sf|sd|chi|ny|sea|bos|phl|dc|den|det)-/, "").replace(/-/g, " ").replace(/\bcluster\s*\d+\s*/, "");
}

export const GET = wrap(async (req: NextRequest) => {
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

  const items = await getNews(q);
  return NextResponse.json({
    source: `Google News (${cityLabel} safety query)`,
    query: q,
    items,
    disclaimer: "Headlines aggregated from Google News. Click through to read the original article at the source.",
  });
});
