import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { PostStatus, PostKind } from "@prisma/client";
import { wrap, HttpError } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";
import { preVetPost, POST_RATE_LIMIT_PER_DAY } from "@/server/services/moderation/post-prevet";
import { isSuspended } from "@/server/services/moderation/suspension";

const Body = z.object({
  areaSlug: z.string().min(1),
  kind: z.nativeEnum(PostKind),
  what:  z.string().min(15).max(500),
  where: z.string().min(3).max(120),
  when:  z.string().min(3).max(120),
  acceptedDefamationNotice: z.literal(true),
  acceptedText: z.string().min(10),
});

function compose(input: { what: string; where: string; when: string }) {
  return `What: ${input.what.trim()}\nWhere: ${input.where.trim()}\nWhen: ${input.when.trim()}`;
}

export const dynamic = "force-dynamic";

export const GET = wrap(async (req: NextRequest) => {
  const areaSlug = req.nextUrl.searchParams.get("area") ?? "";
  const where = areaSlug
    ? { status: PostStatus.VERIFIED, area: { slug: areaSlug } }
    : { status: PostStatus.VERIFIED };
  const posts = await prisma.post.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      author: { select: { id: true, displayName: true } },
      area: true,
      reactions: true,
      _count: { select: { comments: true, reactions: true, reports: true } },
    },
  });
  return NextResponse.json(posts);
});

export const POST = wrap(async (req: NextRequest) => {
  const session = requireSession(req);
  if (await isSuspended(session.uid)) throw new HttpError(403, "user_suspended");

  const input = Body.parse(await req.json());
  const area = await prisma.area.findUnique({ where: { slug: input.areaSlug } });
  if (!area) throw new HttpError(404, "unknown_area");

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const todays = await prisma.post.count({ where: { authorId: session.uid, createdAt: { gte: since } } });
  if (todays >= POST_RATE_LIMIT_PER_DAY) throw new HttpError(429, "daily_post_limit_reached");

  const body = compose(input);
  const vet = preVetPost(body);
  if (vet.block) {
    return NextResponse.json(
      { error: "post_rejected", guidance: vet.inlineGuidance, flags: vet.flags.map((f) => f.kind) },
      { status: 422 },
    );
  }

  const post = await prisma.post.create({
    data: {
      authorId: session.uid,
      areaId: area.id,
      kind: input.kind,
      body,
      status: PostStatus.PENDING,
      flags: { create: vet.flags.map((f) => ({ kind: f.kind, detail: f.detail })) },
      acknowledgement: {
        create: { userId: session.uid, acceptedText: input.acceptedText },
      },
    },
    include: { flags: true },
  });
  return NextResponse.json({ post, heldForReview: vet.hold }, { status: 201 });
});
