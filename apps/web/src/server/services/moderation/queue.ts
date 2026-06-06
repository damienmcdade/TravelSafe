import { prisma } from "../../lib/prisma";
import { PostStatus, ReviewActionKind } from "@/generated/prisma/client";
import { HttpError } from "../../lib/http";
import { evaluateSuspension } from "./suspension";
import { REPORT_AUTO_REVERT_THRESHOLD } from "./post-prevet";
import { publishCommunityEvent } from "../community/events";
import { applyTrustLevel } from "../community/trust";

export async function listPendingPosts(limit = 50) {
  return prisma.post.findMany({
    where: { status: { in: [PostStatus.PENDING, PostStatus.NEEDS_EDITS] } },
    include: { flags: true, author: { select: { id: true, email: true, displayName: true } }, area: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export async function reviewPost(reviewerId: string, postId: string, action: ReviewActionKind, opts: { reason?: string; confirmedAreaLevelAndAnonymized?: boolean } = {}) {
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) throw new HttpError(404, "post_not_found");

  if (action === ReviewActionKind.VERIFY && !opts.confirmedAreaLevelAndAnonymized) {
    throw new HttpError(400, "must_confirm_area_level_and_anonymized");
  }

  const nextStatus =
    action === ReviewActionKind.VERIFY ? PostStatus.VERIFIED :
    action === ReviewActionKind.REJECT ? PostStatus.REJECTED :
    action === ReviewActionKind.REQUEST_EDITS ? PostStatus.NEEDS_EDITS :
    PostStatus.PENDING;

  await prisma.$transaction([
    prisma.post.update({
      where: { id: postId },
      data: {
        status: nextStatus,
        reviewedAt: new Date(),
        reviewerId,
        rejectionReason: action === ReviewActionKind.REJECT ? opts.reason ?? null : null,
      },
    }),
    prisma.postReviewAction.create({
      data: {
        postId,
        reviewerId,
        kind: action,
        reason: opts.reason,
        confirmedAreaLevelAndAnonymized: !!opts.confirmedAreaLevelAndAnonymized,
      },
    }),
  ]);

  if (action === ReviewActionKind.REJECT) {
    await evaluateSuspension(post.authorId);
  }
  // Recompute the author's trust level on every state-changing review
  // (VERIFY or REJECT). Both events shift the verified/rejected counts
  // the trust formula reads, so it's the right place to land
  // promotions and demotions. Wrapped in try/catch so a transient
  // trust-recompute failure can't fail the actual moderation action —
  // the moderation result is the user-facing operation; trust is a
  // derived signal that catches up on the next review.
  if (action === ReviewActionKind.VERIFY || action === ReviewActionKind.REJECT) {
    try { await applyTrustLevel(post.authorId); }
    catch (err) { console.warn("[moderation] trust recompute failed:", (err as Error).message); }
  }
  if (nextStatus === PostStatus.VERIFIED) {
    const area = await prisma.area.findUnique({ where: { id: post.areaId }, select: { slug: true } });
    publishCommunityEvent({
      type: "post.verified",
      postId: post.id,
      areaSlug: area?.slug ?? "",
      kind: post.kind,
      reviewedAt: new Date().toISOString(),
    });
  }
  return { ok: true };
}

export async function reportPost(reporterId: string, postId: string, reason?: string) {
  // fix(audit report-no-existence-guard): mirror the react/comment routes —
  // validate the post exists, is VERIFIED, and isn't soft-deleted BEFORE the
  // upsert. A blind upsert with a bogus postId hit an FK violation (P2003) → 500
  // instead of a clean 404, and let users report hidden/removed posts.
  const post = await prisma.post.findUnique({ where: { id: postId }, select: { status: true, deletedAt: true } });
  if (!post || post.status !== PostStatus.VERIFIED || post.deletedAt) {
    throw new HttpError(404, "post_not_found");
  }
  await prisma.postReport.upsert({
    where: { postId_reporterId: { postId, reporterId } },
    update: { reason },
    create: { postId, reporterId, reason },
  });
  const reportCount = await prisma.postReport.count({ where: { postId } });
  await prisma.post.update({ where: { id: postId }, data: { reportCount } });

  if (reportCount >= REPORT_AUTO_REVERT_THRESHOLD) {
    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (post?.status === PostStatus.VERIFIED) {
      await prisma.post.update({ where: { id: postId }, data: { status: PostStatus.PENDING, reviewedAt: null, reviewerId: null } });
      await prisma.postReviewAction.create({
        data: { postId, reviewerId: reporterId, kind: ReviewActionKind.REVERT_TO_PENDING, reason: `auto-reverted after ${reportCount} reports` },
      });
      const area = await prisma.area.findUnique({ where: { id: post.areaId }, select: { slug: true } });
      publishCommunityEvent({ type: "post.reverted", postId: post.id, areaSlug: area?.slug ?? "" });
    }
  }
  return { ok: true, reportCount };
}
