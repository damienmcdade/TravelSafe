import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { PostStatus } from "@/generated/prisma/client";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";
import { preVetPost } from "@/server/services/moderation/post-prevet";

const Body = z.object({ body: z.string().min(2).max(500) });

export const POST = wrap(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const session = requireSession(req);
  const { id } = await params;
  const { body } = Body.parse(await req.json());
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
