import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap, HttpError } from "@/server/lib/http";
import { getAreaInsights } from "@/server/services/crime-data/insights";

const Query = z.object({
  neighborhood: z.string().optional(),
  jurisdiction: z.string().optional(),
});

export const dynamic = "force-dynamic";
export const GET = wrap(async (req: NextRequest) => {
  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const area = q.neighborhood ?? q.jurisdiction;
  if (!area) throw new HttpError(400, "area_required");
  return NextResponse.json(await getAreaInsights(area));
});
