import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { markSafe } from "@/server/services/safety/check-in";

export const POST = wrap(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const session = requireSession(req);
  const { id } = await params;
  return NextResponse.json(await markSafe(session.uid, id));
});
