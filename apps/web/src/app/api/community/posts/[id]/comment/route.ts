import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { PostStatus } from "@/generated/prisma/client";
import { wrap, HttpError } from "@/server/lib/http";
import { optionalSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";
import { preVetPost } from "@/server/services/moderation/post-prevet";
import { isSuspended } from "@/server/services/moderation/suspension";
import { ensureAnonymousUser } from "@/server/services/community/anon-user";
import { anonPostLimited } from "@/server/lib/rate-limit";
import { publishCommunityEvent } from "@/server/services/community/events";

export const dynamic = "force-dynamic";

// Anonymous comments share the posts pattern: a single shared author row, so the
// per-IP limiter is what actually bounds one source. Separate "comment" scope so
// commenting can't exhaust the posting budget.
const ANON_BURST_LIMIT = 8;          // comments per IP per...
const ANON_BURST_WINDOW_SEC = 600;   // ...10 minutes
const ANON_DAILY_LIMIT = 40;         // comments per IP per day

/// Public list of a post's VISIBLE comments (oldest-first, like a thread).
export const GET = wrap(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const comments = await prisma.postComment.findMany({
    where: { postId: id, status: PostStatus.VERIFIED },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { displayName: true, trustLevel: true } },
    },
  });
  return NextResponse.json(comments, { headers: { "Cache-Control": "no-store" } });
});

const Body = z.object({ body: z.string().min(2).max(500) });

export const POST = wrap(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const session = await optionalSession(req);
  let authorId: string;
  if (session) {
    if (await isSuspended(session.uid)) throw new HttpError(403, "user_suspended");
    authorId = session.uid;
  } else {
    if (await anonPostLimited(req, {
      burstLimit: ANON_BURST_LIMIT,
      burstWindowSec: ANON_BURST_WINDOW_SEC,
      dailyLimit: ANON_DAILY_LIMIT,
      scope: "comment",
    })) {
      throw new HttpError(429, "rate_limited");
    }
    const anon = await ensureAnonymousUser();
    authorId = anon.id;
  }

  const { id } = await params;
  const { body } = Body.parse(await req.json());
  // Verify the parent post exists AND is publicly VISIBLE (VERIFIED, not
  // soft-deleted) before attaching a comment — the FK only guarantees the row
  // exists, not that it's visible.
  const post = await prisma.post.findUnique({ where: { id }, select: { status: true, deletedAt: true, areaId: true } });
  if (!post || post.status !== PostStatus.VERIFIED || post.deletedAt) {
    return NextResponse.json({ error: "post_not_found" }, { status: 404 });
  }
  const vet = preVetPost(body);
  if (vet.block) return NextResponse.json({ error: "comment_rejected", guidance: vet.inlineGuidance }, { status: 422 });
  const comment = await prisma.postComment.create({
    data: {
      postId: id,
      authorId,
      body,
      status: vet.hold ? PostStatus.PENDING : PostStatus.VERIFIED,
    },
    select: {
      id: true,
      body: true,
      createdAt: true,
      status: true,
      author: { select: { displayName: true, trustLevel: true } },
    },
  });
  // Notify open feeds that a comment landed so counts/threads can refresh live.
  if (comment.status === PostStatus.VERIFIED) {
    publishCommunityEvent({ type: "comment.created", postId: id });
  }
  return NextResponse.json(comment, { status: 201 });
});
