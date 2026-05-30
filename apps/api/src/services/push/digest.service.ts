import { NotificationFrequency } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { sendToMany } from "./webpush.service.js";

export interface DigestResult {
  durationMs: number;
  eligibleUsers: number;
  users: number;
  sent: number;
  failed: number;
  pruned: number;
}

// Daily push-digest fan-out. Same eligibility shape as the prior
// Vercel cron handler at apps/web/src/app/api/cron/push-digest:
//   - User has at least one PushSubscription
//   - AlertPreference.notificationFrequency = DIGEST_DAILY
//   - Not permanently banned, no active suspension
export async function runDailyDigest(): Promise<DigestResult> {
  const startedAt = Date.now();
  const candidates = await prisma.user.findMany({
    where: {
      pushSubscriptions: { some: {} },
      alertPreference: { notificationFrequency: NotificationFrequency.DIGEST_DAILY },
      permanentlyBanned: false,
      OR: [
        { suspendedUntil: null },
        { suspendedUntil: { lt: new Date() } },
      ],
    },
    select: { id: true },
  });

  const userIds = candidates.map((u) => u.id);
  const result = userIds.length > 0
    ? await sendToMany(userIds, {
        title: "CommunitySafe — today's digest",
        body: "Check what's happening in your areas. Tap to open.",
        tag: "digest-daily",
        data: { url: "/threats" },
      })
    : { users: 0, sent: 0, failed: 0, pruned: 0 };

  return {
    durationMs: Date.now() - startedAt,
    eligibleUsers: userIds.length,
    ...result,
  };
}
