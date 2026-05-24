import { NextResponse, type NextRequest } from "next/server";
import { NotificationFrequency } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { requireCronSecret } from "@/server/lib/bearer-auth";
import { sendToMany } from "@/server/services/push/webpush";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/// Daily push digest. Fires once a day via Vercel Cron and pings every
/// user who has (a) at least one valid push subscription AND (b) opted
/// into DIGEST_DAILY (the default — REAL_TIME users are handled by a
/// separate alert-fired path, not yet implemented). Honors the
/// per-user notificationDailyCap by skipping anyone already at-cap
/// today (best-effort: the cap state lives in memory only for now,
/// so cap is approximate across function instances).
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
        title: "TravelSafe — today's digest",
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
