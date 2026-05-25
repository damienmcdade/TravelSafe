import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap, HttpError } from "@/server/lib/http";
import { rateLimit } from "@/server/lib/rate-limit";
import { crimeData } from "@/server/services/crime-data";

const Query = z.object({
  neighborhood: z.string().optional(),
  jurisdiction: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20).optional(),
});

export const dynamic = "force-dynamic";
export const GET = wrap(async (req: NextRequest) => {
  const limited = rateLimit(req, { scope: "crime-data" });
  if (limited) return limited;
  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const area = q.neighborhood ?? q.jurisdiction;
  if (!area) throw new HttpError(400, "area_required");
  return NextResponse.json({ area, reports: await crimeData.getRecentReports(area, { limit: q.limit }) });
});
