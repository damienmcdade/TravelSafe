import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ReactionKind } from "@/generated/prisma/client";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";

export const POST = wrap(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(req);
  const { id } = await params;
  const kind = z.nativeEnum(ReactionKind).parse((await req.json())?.kind);
  await prisma.postReaction.upsert({
    where: { postId_userId_kind: { postId: id, userId: session.uid, kind } },
    create: { postId: id, userId: session.uid, kind },
    update: {},
  });
  return NextResponse.json({ ok: true });
});
