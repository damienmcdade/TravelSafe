import { prisma } from "../../lib/prisma.js";
import { PostStatus, ReviewActionKind } from "../../generated/prisma/client";
import { HttpError } from "../../middleware/error.js";
import { evaluateSuspension } from "./suspension.service.js";
import { REPORT_AUTO_REVERT_THRESHOLD } from "./post-prevet.js";
import { communityEvents } from "../community/events.js";

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
  if (nextStatus === PostStatus.VERIFIED) {
    const area = await prisma.area.findUnique({ where: { id: post.areaId }, select: { slug: true } });
    communityEvents.emit("event", {
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
      communityEvents.emit("event", { type: "post.reverted", postId: post.id, areaSlug: area?.slug ?? "" });
    }
  }
  return { ok: true, reportCount };
}
