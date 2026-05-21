import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { createLiveShare, listLiveShares } from "@/server/services/safety/live-share";

const Body = z.object({
  durationMinutes: z.number().int().min(5).max(240),
  contactEmail: z.string().email().optional(),
});

export const dynamic = "force-dynamic";

export const GET = wrap(async (req: NextRequest) => {
  const session = requireSession(req);
  return NextResponse.json(await listLiveShares(session.uid));
});

export const POST = wrap(async (req: NextRequest) => {
  const session = requireSession(req);
  return NextResponse.json(await createLiveShare(session.uid, Body.parse(await req.json())), { status: 201 });
});
