import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { resendConfirmation } from "@/server/services/contacts";

export const POST = wrap(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const session = requireSession(req);
  const { id } = await params;
  return NextResponse.json(await resendConfirmation(session.uid, id));
});
