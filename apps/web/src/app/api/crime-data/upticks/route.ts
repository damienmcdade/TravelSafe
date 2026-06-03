import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { rateLimit } from "@/server/lib/rate-limit";
import { tryProxy } from "@/server/lib/proxy-to-api";
import { getCitywideUpticks } from "@/server/services/watch/upticks";
import { withWarmingTimeout } from "@/server/lib/warming-timeout";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Edge cache for 5 min — uptick analysis re-runs at the same cadence as
// the underlying adapter cache. SWR keeps things snappy for repeat
// visitors.
const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=900",
};

export const GET = wrap(async (req: NextRequest) => {
  const limited = rateLimit(req, { scope: "crime-data" });
  if (limited) return limited;
  const proxied = await tryProxy(req, "/crime-data/upticks");
  if (proxied) return proxied.response;

  const citySlug = req.nextUrl.searchParams.get("city") ?? "san-diego";
  return withWarmingTimeout(getCitywideUpticks(citySlug), (v) => NextResponse.json(v, { headers: CACHE_HEADERS }));
});
