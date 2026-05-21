import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ReviewActionKind } from "@prisma/client";
import { wrap } from "@/server/lib/http";
import { requireSession, requireModerator } from "@/server/lib/auth";
import { env } from "@/server/lib/env";
import { reviewPost } from "@/server/services/moderation/queue";

const Body = z.object({
  action: z.nativeEnum(ReviewActionKind),
  reason: z.string().max(500).optional(),
  confirmedAreaLevelAndAnonymized: z.boolean().optional(),
});

export const POST = wrap(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const session = requireSession(req);
  requireModerator(session, env.MODERATOR_EMAILS);
  const { id } = await params;
  const body = Body.parse(await req.json());
  return NextResponse.json(await reviewPost(session.uid, id, body.action, body));
});
