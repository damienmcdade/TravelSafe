import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap, HttpError } from "@/server/lib/http";
import { crimeData } from "@/server/services/crime-data";
import { nearestArea } from "@/server/services/crime-data/neighborhoods";

const Query = z.object({
  neighborhood: z.string().optional(),
  jurisdiction: z.string().optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
});

export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
};

export const GET = wrap(async (req: NextRequest) => {
  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const area = q.neighborhood ?? q.jurisdiction ?? (q.lat != null && q.lng != null ? nearestArea({ lat: q.lat, lng: q.lng })?.slug ?? null : null);
  if (!area) throw new HttpError(400, "area_required");
  return NextResponse.json(await crimeData.getAreaStats(area), { headers: CACHE_HEADERS });
});
