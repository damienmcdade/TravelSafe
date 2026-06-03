import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { PostStatus } from "@/generated/prisma/client";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";
import { preVetPost } from "@/server/services/moderation/post-prevet";

const Body = z.object({ body: z.string().min(2).max(500) });

export const POST = wrap(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(req);
  const { id } = await params;
  const { body } = Body.parse(await req.json());
  // v106 (security audit) — verify the parent post exists AND is VERIFIED
  // before attaching a comment. Previously a comment could be created against a
  // PENDING / removed / hidden post (the FK only guarantees the row exists, not
  // that it's publicly visible), letting users comment on non-visible content.
  // fix(audit db-post-softdelete-2): also treat a soft-deleted post as not-found.
  const post = await prisma.post.findUnique({ where: { id }, select: { status: true, deletedAt: true } });
  if (!post || post.status !== PostStatus.VERIFIED || post.deletedAt) {
    return NextResponse.json({ error: "post_not_found" }, { status: 404 });
  }
  const vet = preVetPost(body);
  if (vet.block) return NextResponse.json({ error: "comment_rejected", guidance: vet.inlineGuidance }, { status: 422 });
  const comment = await prisma.postComment.create({
    data: {
      postId: id,
      authorId: session.uid,
      body,
      status: vet.hold ? PostStatus.PENDING : PostStatus.VERIFIED,
    },
  });
  return NextResponse.json(comment, { status: 201 });
});
