import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { getSafeRoute, type Mode } from "@/server/services/route/safe-route";

// Walking + driving only. The Mode type in safe-route.ts still includes
// "transit" as a driving-leg proxy for legacy callers, but we no longer
// accept it through the public API — transit was retired from the UI and
// we want the API surface to match the product surface.
const Query = z.object({
  fromLat: z.coerce.number().finite(),
  fromLng: z.coerce.number().finite(),
  toLat:   z.coerce.number().finite(),
  toLng:   z.coerce.number().finite(),
  mode:    z.enum(["walking", "driving"]).default("walking"),
  /// ISO timestamp of the planned travel time. When present and
  /// falls in night hours (20:00-06:00 local), the scorer boosts
  /// the weight of incidents that ALSO occurred at night. Active
  /// incidents (last 24h) are always boosted regardless.
  travelAt: z.string().optional(),
});

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export const GET = wrap(async (req: NextRequest) => {
  const { fromLat, fromLng, toLat, toLng, mode, travelAt } = Query.parse(
    Object.fromEntries(req.nextUrl.searchParams),
  );
  let travelAtDate: Date | undefined;
  if (travelAt) {
    const d = new Date(travelAt);
    if (!Number.isNaN(d.getTime())) travelAtDate = d;
  }
  const result = await getSafeRoute(
    { lat: fromLat, lng: fromLng },
    { lat: toLat,   lng: toLng   },
    mode as Mode,
    travelAtDate,
  );
  return NextResponse.json(result);
});
