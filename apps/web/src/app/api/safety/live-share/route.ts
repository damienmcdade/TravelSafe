import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { createLiveShare, listLiveShares } from "@/server/services/safety/live-share";

// v47 — accepts either an email or a phone number in one "contact"
// field. Validation is loose on purpose so the server can classify
// (emails go to SMTP, phone numbers normalize to E.164 → Twilio);
// the service layer surfaces a `delivery` object back to the client
// so UI can show "saved but not sent" when SMTP/Twilio are missing.
// contactEmail remains accepted for back-compat with the prior client
// shape.
const Body = z.object({
  durationMinutes: z.number().int().min(5).max(240),
  contact: z.string().min(1).max(200).optional(),
  contactEmail: z.string().min(1).max(200).optional(),
});

export const dynamic = "force-dynamic";

export const GET = wrap(async (req: NextRequest) => {
  const session = await requireSession(req);
  return NextResponse.json(await listLiveShares(session.uid));
});

export const POST = wrap(async (req: NextRequest) => {
  const session = await requireSession(req);
  return NextResponse.json(await createLiveShare(session.uid, Body.parse(await req.json())), { status: 201 });
});
