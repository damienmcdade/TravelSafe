import { prisma } from "../../lib/prisma";
import { SuspensionKind, PostStatus } from "@/generated/prisma/client";

// Balanced suspension ladder (confirmed with user):
//   2 rejected within 7d   -> 24h posting timeout
//   4 rejected within 30d  -> 7-day suspension
//   6 rejected within 90d  -> permanent ban (manual lift)

const RULES = [
  { window: 7,  threshold: 2, lengthDays: 1,  kind: SuspensionKind.TEMPORARY, label: "24h timeout" },
  { window: 30, threshold: 4, lengthDays: 7,  kind: SuspensionKind.TEMPORARY, label: "7-day suspension" },
  { window: 90, threshold: 6, lengthDays: 0,  kind: SuspensionKind.PERMANENT, label: "permanent ban" },
] as const;

const day = 24 * 60 * 60 * 1000;

/// Call after marking a post REJECTED. Re-evaluates the user's recent rejection
/// record and applies the strongest matching rung of the suspension ladder.
export async function evaluateSuspension(userId: string) {
  const now = new Date();
  const longest = Math.max(...RULES.map((r) => r.window));
  const since = new Date(now.getTime() - longest * day);

  const rejected = await prisma.post.findMany({
    where: { authorId: userId, status: PostStatus.REJECTED, reviewedAt: { gte: since } },
    select: { reviewedAt: true },
  });

  for (const rule of [...RULES].reverse()) {
    const cutoff = new Date(now.getTime() - rule.window * day);
    const count = rejected.filter((p) => p.reviewedAt && p.reviewedAt >= cutoff).length;
    if (count >= rule.threshold) {
      const until = rule.kind === SuspensionKind.PERMANENT ? null : new Date(now.getTime() + rule.lengthDays * day);
      await prisma.user.update({
        where: { id: userId },
        data: { suspendedUntil: until, permanentlyBanned: rule.kind === SuspensionKind.PERMANENT },
      });
      await prisma.suspensionEvent.create({
        data: {
          userId,
          kind: rule.kind,
          reason: `${count} rejected post${count === 1 ? "" : "s"} within ${rule.window} days`,
          until,
        },
      });
      return { applied: true, rule: rule.label };
    }
  }
  return { applied: false };
}

export async function isSuspended(userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { suspendedUntil: true, permanentlyBanned: true },
  });
  if (!u) return false;
  if (u.permanentlyBanned) return true;
  if (u.suspendedUntil && u.suspendedUntil > new Date()) return true;
  return false;
}
