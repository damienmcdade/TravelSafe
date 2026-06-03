import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ReactionKind, PostStatus } from "@/generated/prisma/client";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";

export const POST = wrap(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(req);
  const { id } = await params;
  const kind = z.nativeEnum(ReactionKind).parse((await req.json())?.kind);
  // fix(audit pentest-authz-1 / api-code-4): verify the post exists AND is
  // VERIFIED before reacting — the same guard the comment route already has.
  // Previously a blind upsert against a missing post FK'd to a 500 (not 404),
  // and a user could react to a PENDING / removed / hidden post.
  const post = await prisma.post.findUnique({ where: { id }, select: { status: true } });
  if (!post || post.status !== PostStatus.VERIFIED) {
    return NextResponse.json({ error: "post_not_found" }, { status: 404 });
  }
  await prisma.postReaction.upsert({
    where: { postId_userId_kind: { postId: id, userId: session.uid, kind } },
    create: { postId: id, userId: session.uid, kind },
    update: {},
  });
  return NextResponse.json({ ok: true });
});
