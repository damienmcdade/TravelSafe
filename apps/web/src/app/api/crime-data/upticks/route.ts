import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { getCitywideUpticks } from "@/server/services/watch/upticks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Edge cache for 5 min — uptick analysis re-runs at the same cadence as
// the underlying adapter cache. SWR keeps things snappy for repeat
// visitors.
const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
};

export const GET = wrap(async (req: NextRequest) => {
  const citySlug = req.nextUrl.searchParams.get("city") ?? "san-diego";
  return NextResponse.json(await getCitywideUpticks(citySlug), { headers: CACHE_HEADERS });
});
