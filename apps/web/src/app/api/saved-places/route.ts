import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { latitude, longitude } from "@/server/lib/coords";
import { listSavedPlaces, createSavedPlace } from "@/server/services/safety/saved-places";

const CreateBody = z.object({
  label: z.string().min(1).max(60),
  lat: latitude,
  lng: longitude,
  radiusM: z.number().int().min(200).max(5000).optional(),
});

export const GET = wrap(async (req: NextRequest) => {
  const session = await requireSession(req);
  return NextResponse.json({ places: await listSavedPlaces(session.uid) });
});

export const POST = wrap(async (req: NextRequest) => {
  const session = await requireSession(req);
  const place = await createSavedPlace(session.uid, CreateBody.parse(await req.json()));
  return NextResponse.json(place, { status: 201 });
});
