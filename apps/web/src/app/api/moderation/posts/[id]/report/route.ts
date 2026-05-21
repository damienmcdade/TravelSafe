import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { reportPost } from "@/server/services/moderation/queue";

const Body = z.object({ reason: z.string().max(500).optional() });

export const POST = wrap(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const session = requireSession(req);
  const { id } = await params;
  const body = Body.parse(await req.json().catch(() => ({})));
  return NextResponse.json(await reportPost(session.uid, id, body.reason));
});
