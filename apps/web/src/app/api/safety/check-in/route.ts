import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { armCheckIn } from "@/server/services/safety/check-in";

const Body = z.object({
  durationMinutes: z.number().int().min(1).max(240),
  message: z.string().max(200).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

export const POST = wrap(async (req: NextRequest) => {
  const session = await requireSession(req);
  return NextResponse.json(await armCheckIn(session.uid, Body.parse(await req.json())), { status: 201 });
});
