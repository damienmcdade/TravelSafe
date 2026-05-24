import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { generateIncidentSummary } from "@/server/services/ai/incident-summary";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CACHE_HEADERS = {
  // 5-min edge cache + SWR for snappy repeat hits. The underlying
  // service has its own 30-min in-memory cache so the LLM only
  // runs at most twice per area per hour.
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
};

/// AI-summarized recent-activity card for a neighborhood or city.
/// Returns deterministic fields (severity, trend, changePct) even
/// when the LLM is unavailable, so the UI can render a useful
/// summary card either way.
export const GET = wrap(async (req: NextRequest) => {
  const area = req.nextUrl.searchParams.get("area");
  const citySlug = req.nextUrl.searchParams.get("city");
  const windowDaysRaw = req.nextUrl.searchParams.get("windowDays");
  const windowDays = windowDaysRaw && Number.isFinite(Number(windowDaysRaw))
    ? Number(windowDaysRaw)
    : 30;

  const data = area
    ? await generateIncidentSummary({ area, windowDays })
    : citySlug
      ? await generateIncidentSummary({ cityOnly: { citySlug }, windowDays })
      : null;

  if (!data) {
    return NextResponse.json(
      { error: "summary_unavailable", reason: "Pass ?area= or ?city=" },
      { status: 400, headers: CACHE_HEADERS },
    );
  }
  return NextResponse.json(data, { headers: CACHE_HEADERS });
});
