import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { triggerSos } from "@/server/services/safety/sos";
import { latitude, longitude } from "@/server/lib/coords";

const Body = z.object({
  lat: latitude.optional(),
  lng: longitude.optional(),
  message: z.string().max(200).optional(),
  durationMinutes: z.number().int().min(5).max(240).optional(),
});

export const POST = wrap(async (req: NextRequest) => {
  const session = await requireSession(req);
  const result = await triggerSos(session.uid, Body.parse(await req.json().catch(() => ({}))));
  return NextResponse.json(result, { status: 201 });
});
