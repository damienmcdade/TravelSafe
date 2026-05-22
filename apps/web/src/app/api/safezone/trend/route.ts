import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { getTrendForArea } from "@/server/services/watch/trend-feed";

const Query = z.object({
  area: z.string().min(1).max(120),
  label: z.string().min(1).max(120).optional(),
});

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export const GET = wrap(async (req: NextRequest) => {
  const { area, label } = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  return NextResponse.json(await getTrendForArea(area, label ?? area));
});
