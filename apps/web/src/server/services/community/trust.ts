import "server-only";
import { prisma } from "@/server/lib/prisma";
import { TrustLevel, PostStatus } from "@/generated/prisma/client";

/// Trust thresholds. NEW → REGULAR → TRUSTED is fully automatic; the
/// MODERATOR tier is granted manually (no auto-promotion path here so
/// the moderator role can't be silently inflated). Thresholds are
/// intentionally conservative — better to undergrade than to label
/// a chronic over-poster as TRUSTED.
const PROMOTION = {
  REGULAR_MIN_VERIFIED:  3,
  TRUSTED_MIN_VERIFIED:  10,
  REGULAR_MAX_REJECT_RATE: 0.05,   // ≤5% rejected
  TRUSTED_MAX_REJECT_RATE: 0.02,   // ≤2% rejected
} as const;

/// Compute the trust level a user should have, given their post history.
/// MODERATOR is preserved as-is — the auto-recompute can never demote a
/// MODERATOR (those changes happen via an admin action, not the score).
export async function computeTrustLevel(userId: string): Promise<TrustLevel> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { trustLevel: true },
  });
  if (!user) return TrustLevel.NEW;
  if (user.trustLevel === TrustLevel.MODERATOR) return TrustLevel.MODERATOR;

  const counts = await prisma.post.groupBy({
    by: ["status"],
    where: { authorId: userId },
    _count: { status: true },
  });
  const verified = counts.find((c) => c.status === PostStatus.VERIFIED)?._count.status ?? 0;
  const rejected = counts.find((c) => c.status === PostStatus.REJECTED)?._count.status ?? 0;
  const totalDecided = verified + rejected;
  const rejectRate = totalDecided > 0 ? rejected / totalDecided : 0;

  if (verified >= PROMOTION.TRUSTED_MIN_VERIFIED && rejectRate <= PROMOTION.TRUSTED_MAX_REJECT_RATE) {
    return TrustLevel.TRUSTED;
  }
  if (verified >= PROMOTION.REGULAR_MIN_VERIFIED && rejectRate <= PROMOTION.REGULAR_MAX_REJECT_RATE) {
    return TrustLevel.REGULAR;
  }
  return TrustLevel.NEW;
}

/// Apply the computed trust level if it differs from what's stored. Sets
/// trustVerifiedAt on first TRUSTED promotion; never clears it on
/// subsequent demotions so the historical milestone remains queryable.
/// Returns the level that's now stored.
export async function applyTrustLevel(userId: string): Promise<TrustLevel> {
  const next = await computeTrustLevel(userId);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { trustLevel: true, trustVerifiedAt: true },
  });
  if (!user) return next;
  if (user.trustLevel === next) return next;
  await prisma.user.update({
    where: { id: userId },
    data: {
      trustLevel: next,
      trustVerifiedAt: next === TrustLevel.TRUSTED && user.trustVerifiedAt == null
        ? new Date()
        : user.trustVerifiedAt ?? undefined,
    },
  });
  return next;
}
