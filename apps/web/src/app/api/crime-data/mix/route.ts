import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { rateLimit } from "@/server/lib/rate-limit";
import { tryProxy } from "@/server/lib/proxy-to-api";
import { getCrimeMix, getCitywideCrimeMix } from "@/server/services/crime-data/mix";
import { withWarmingTimeout } from "@/server/lib/warming-timeout";

/// Two modes share this route:
///   ?city=<slug>                      → citywide aggregate
///   ?neighborhood=<slug>              → specific area
/// `jurisdiction` is a legacy alias for `neighborhood` (a few callers
/// still pass it pointing at an actual area slug; we honor that), and
/// `days` is retained as a no-op for back-compat. Citywide and per-area
/// both return the same CrimeMix shape so the client renders with one
/// branch.
const Query = z.object({
  city: z.string().min(1).max(120).optional(),
  neighborhood: z.string().optional(),
  jurisdiction: z.string().optional(),
  days: z.coerce.number().int().min(1).max(730).optional(),
});

export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=900",
};

export const GET = wrap(async (req: NextRequest) => {
  const limited = rateLimit(req, { scope: "crime-data" });
  if (limited) return limited;
  const proxied = await tryProxy(req, "/crime-data/mix");
  if (proxied) return proxied.response;

  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  if (q.city) return withWarmingTimeout(getCitywideCrimeMix(q.city), (v) => NextResponse.json(v, { headers: CACHE_HEADERS }));
  const area = q.neighborhood ?? q.jurisdiction ?? "san-diego";
  return withWarmingTimeout(getCrimeMix(area, q.days), (v) => NextResponse.json(v, { headers: CACHE_HEADERS }));
});
