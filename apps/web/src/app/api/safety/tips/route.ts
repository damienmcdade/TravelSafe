import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { getSafetyTipsForArea } from "@/server/services/safety/tips";

const Query = z.object({
  neighborhood: z.string().optional(),
  jurisdiction: z.string().optional(),
});

export const dynamic = "force-dynamic";

// Safety tips are hard-coded per city — long-lived edge cache is safe.
const STABLE_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};

export const GET = wrap(async (req: NextRequest) => {
  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const area = q.neighborhood ?? q.jurisdiction ?? "san-diego";
  return NextResponse.json(await getSafetyTipsForArea(area), { headers: STABLE_CACHE_HEADERS });
});
