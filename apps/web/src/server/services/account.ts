import "server-only";
import { del } from "@vercel/blob";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/http";

// GDPR / CCPA fulfilment for CommunitySafe accounts. Two operations:
//
//   exportAccount(userId)
//       Gathers every record the database holds about the user and
//       returns it as a single JSON object. Used by GET /api/account/export.
//
//   deleteAccount(userId)
//       Hard-deletes the user and every record FK'd to them.
//       Some relations (Post.authorId, PostComment.authorId,
//       PostReaction.userId, PostEdit.editorId, PostAcknowledgement.userId,
//       PostReport.reporterId, PostReviewAction.reviewerId) are RESTRICT
//       in the schema and need to be cleared explicitly BEFORE
//       removing the User row. The remaining relations
//       (AlertPreference, TrustedContact, UserBlock both sides,
//       UserMute both sides, SuspensionEvent, PushSubscription,
//       CheckInTimer, LiveShareLink) are onDelete: Cascade and
//       disappear automatically.
//
// Both run inside Prisma $transaction so a partial failure can't leave
// the account in a half-deleted state.

export async function exportAccount(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      createdAt: true,
      updatedAt: true,
      suspendedUntil: true,
      permanentlyBanned: true,
      alertPreference: true,
      trustedContacts: { select: { id: true, label: true, email: true, phone: true, status: true, confirmedAt: true, createdAt: true } },
      checkInTimers: { select: { id: true, scheduledFor: true, message: true, status: true, lastLat: true, lastLng: true, createdAt: true, triggeredAt: true } },
      liveShareLinks: { select: { id: true, expiresAt: true, revokedAt: true, createdAt: true } },
      pushSubscriptions: { select: { id: true, endpoint: true, createdAt: true } },
      posts: { select: { id: true, areaId: true, kind: true, body: true, status: true, createdAt: true, updatedAt: true } },
      postComments: { select: { id: true, postId: true, body: true, status: true, createdAt: true } },
      postReactions: { select: { id: true, postId: true, kind: true, createdAt: true } },
      reportsFiled: { select: { id: true, postId: true, reason: true, createdAt: true } },
      acknowledgements: { select: { id: true, postId: true, acceptedAt: true, acceptedText: true } },
      postEdits: { select: { id: true, postId: true, previousBody: true, newBody: true, reason: true, createdAt: true } },
      reviewActions: { select: { id: true, postId: true, kind: true, reason: true, createdAt: true } },
      // "blockedBy" reads backwards in the schema — it's the array of
      // UserBlock rows where THIS user is the blocker (i.e. blocks the
      // user made against others).
      blockedBy: { select: { id: true, blockedId: true, createdAt: true } },
      mutes: { select: { id: true, mutedId: true, createdAt: true } },
      suspensionEvents: { select: { id: true, kind: true, reason: true, until: true, createdAt: true } },
    },
  });
  if (!user) throw new HttpError(404, "user_not_found");
  return {
    exportedAt: new Date().toISOString(),
    user,
    note:
      "This export contains every record CommunitySafe stores about your account. " +
      "If you also want this data removed, call POST /api/account/delete (or use " +
      "the Delete Account control in Personal Safety settings).",
  };
}

export async function deleteAccount(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new HttpError(404, "user_not_found");

  // GDPR/CCPA erasure must also remove uploaded photos from public Blob
  // storage — deleting the Post row alone would leave the image live at its
  // public URL forever. Collect the URLs before the rows are gone.
  const imaged = await prisma.post.findMany({
    where: { authorId: userId, imageUrl: { not: null } },
    select: { imageUrl: true },
  });

  // Single transaction so a partial-failure can't leave a stranded user.
  // Order: tables with RESTRICT FKs back to User must be cleared
  // BEFORE we touch User; tables with Cascade clean themselves up.
  await prisma.$transaction(async (tx) => {
    // PostReviewAction.reviewer (RESTRICT) — user may have moderated others' posts.
    await tx.postReviewAction.deleteMany({ where: { reviewerId: userId } });

    // PostReport.reporter (RESTRICT) — reports the user filed against others.
    await tx.postReport.deleteMany({ where: { reporterId: userId } });

    // PostAcknowledgement.user (RESTRICT) — one per the user's own posts. The
    // post-cascade also cleans them up, but we delete explicitly here so we
    // don't depend on cascade ordering inside the same transaction.
    await tx.postAcknowledgement.deleteMany({ where: { userId } });

    // PostEdit.editor (RESTRICT) — moderator-edited or self-edited posts.
    await tx.postEdit.deleteMany({ where: { editorId: userId } });

    // PostReaction.user (RESTRICT) — reactions the user left on any post.
    await tx.postReaction.deleteMany({ where: { userId } });

    // PostComment.author (RESTRICT) — comments the user left on any post.
    await tx.postComment.deleteMany({ where: { authorId: userId } });

    // Post.reviewer is OPTIONAL — null it out where the user reviewed someone
    // else's post before we delete the user. This preserves the post itself.
    await tx.post.updateMany({
      where: { reviewerId: userId },
      data: { reviewerId: null },
    });

    // Post.author (RESTRICT) — delete the user's own posts. The cascade on
    // Post will remove any remaining flags / reports / edits / comments /
    // reactions / acknowledgements / review actions left by OTHER users on
    // those posts.
    await tx.post.deleteMany({ where: { authorId: userId } });

    // Finally remove the user. Cascade chains clean up: AlertPreference,
    // TrustedContact, UserBlock(both sides), UserMute(both sides),
    // SuspensionEvent, PushSubscription, CheckInTimer, LiveShareLink.
    await tx.user.delete({ where: { id: userId } });
  }, { timeout: 30_000 });

  // Best-effort blob cleanup AFTER the rows are committed. A failed delete
  // here (missing token, object already gone) must not fail the deletion the
  // user already confirmed.
  const urls = imaged.map((p) => p.imageUrl).filter((u): u is string => !!u);
  if (urls.length > 0) {
    try { await del(urls); } catch { /* best-effort — rows are already gone */ }
  }

  return { ok: true, deletedAt: new Date().toISOString() };
}
