import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { updateSavedPlace, deleteSavedPlace } from "@/server/services/safety/saved-places";

const PatchBody = z.object({
  label: z.string().min(1).max(60).optional(),
  radiusM: z.number().int().min(200).max(5000).optional(),
  alertsEnabled: z.boolean().optional(),
});

export const PATCH = wrap(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(req);
  const { id } = await params;
  return NextResponse.json(await updateSavedPlace(session.uid, id, PatchBody.parse(await req.json())));
});

export const DELETE = wrap(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(req);
  const { id } = await params;
  return NextResponse.json(await deleteSavedPlace(session.uid, id));
});
