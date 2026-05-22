import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { getWatchForArea } from "@/server/services/watch/watch";

const Query = z.object({
  area: z.string().min(1).max(120),
  label: z.string().min(1).max(120).optional(),
});

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
};

export const GET = wrap(async (req: NextRequest) => {
  const { area, label } = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const watch = await getWatchForArea(area, label ?? area);
  return NextResponse.json(watch, { headers: CACHE_HEADERS });
});
