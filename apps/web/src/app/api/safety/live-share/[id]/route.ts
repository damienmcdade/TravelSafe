import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { revokeLiveShare } from "@/server/services/safety/live-share";

export const DELETE = wrap(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(req);
  const { id } = await params;
  return NextResponse.json(await revokeLiveShare(session.uid, id));
});
