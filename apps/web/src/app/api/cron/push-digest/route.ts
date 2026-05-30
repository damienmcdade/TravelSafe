import { NextResponse, type NextRequest } from "next/server";
import { NotificationFrequency } from "@/generated/prisma/client";
import { prisma } from "@/server/lib/prisma";
import { requireCronSecret } from "@/server/lib/bearer-auth";
import { sendToMany } from "@/server/services/push/webpush";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/// MIGRATED to Railway as of v15. The daily digest is now fired by
/// apps/api/src/services/push/digest.worker.ts (interval-based, 16:00
/// UTC). This route is kept as a manual-trigger endpoint so operators
/// can still curl the digest on demand without restarting Railway,
/// but the Vercel Cron schedule has been dropped from vercel.json so
/// it no longer auto-fires (which would double-send).
///
/// Payload is intentionally generic — we don't yet have a
/// SavedArea model, so the digest can't personalize per-area.
/// Future work: persist saved areas server-side and personalize the
/// message body to the user's actual watchlist.
export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const startedAt = Date.now();
  const candidates = await prisma.user.findMany({
    where: {
      // Has at least one stored push subscription.
      pushSubscriptions: { some: {} },
      // Honor opt-out: skip users with no preference (default REAL_TIME
      // would only be hit for users created before the AlertPreference
      // default was added, which currently never happens).
      alertPreference: { notificationFrequency: NotificationFrequency.DIGEST_DAILY },
      // Skip suspended / banned accounts — they shouldn't get
      // re-engagement pings.
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
        // SW's notificationclick handler reads notification.data.url
        // to decide where to focus / open. Send it under `data` so
        // the SW finds it; the body of the payload is for visual
        // display only.
        data: { url: "/threats" },
      })
    : { users: 0, sent: 0, failed: 0, pruned: 0 };

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - startedAt,
    eligibleUsers: userIds.length,
    ...result,
  });
}
