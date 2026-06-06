import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { updateLiveShareLocation } from "@/server/services/safety/live-share";

// v113 — the sharer's device POSTs its current position here on a geolocation
// heartbeat while a Live Share is active. Updates every active share the user
// has; the recipient's /share/<token> page polls for it. Rate-limited at 30/min
// by middleware (/api/safety/*) — a ~20s heartbeat is ~3/min, well under.
const Body = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const dynamic = "force-dynamic";

export const POST = wrap(async (req: NextRequest) => {
  const session = await requireSession(req);
  const { lat, lng } = Body.parse(await req.json());
  return NextResponse.json(await updateLiveShareLocation(session.uid, lat, lng));
});
