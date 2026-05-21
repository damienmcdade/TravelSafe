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
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
});

function resolveArea(q: z.infer<typeof Query>): string | null {
  if (q.neighborhood) return q.neighborhood;
  if (q.jurisdiction) return q.jurisdiction;
  if (q.lat != null && q.lng != null) {
    return nearestArea({ lat: q.lat, lng: q.lng })?.slug ?? null;
  }
  return null;
}

export const dynamic = "force-dynamic";
export const GET = wrap(async (req: NextRequest) => {
  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const area = resolveArea(q);
  if (!area) throw new HttpError(400, "area_required");
  return NextResponse.json({ area, alerts: await crimeData.getAreaAlerts(area, { limit: q.limit }) });
});
