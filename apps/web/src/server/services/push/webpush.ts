import "server-only";
import webpush from "web-push";
import { env } from "@/server/lib/env";
import { prisma } from "@/server/lib/prisma";

// Lazy VAPID init. The library throws if setVapidDetails is called
// twice with the same args, and the env vars may not be populated in
// preview deployments — guard so import-time evaluation doesn't blow
// up the route handler when push is intentionally disabled.
let vapidReady = false;
function ensureVapid(): boolean {
  if (vapidReady) return true;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  vapidReady = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  /// Arbitrary client-side context. The service worker stashes this
  /// on `notification.data` so a `notificationclick` handler can route
  /// the user back to the relevant page. Conventional keys: `url`
  /// (string) for the destination path.
  data?: Record<string, unknown>;
}

export interface PushResult {
  sent: number;
  failed: number;
  pruned: number;
  reason?: string;
}

/// Send a single push payload to every stored subscription for the
/// given user, transparently pruning subscriptions the push services
/// reject (HTTP 404/410 means the endpoint is gone and we shouldn't
/// keep trying). Returns counts so callers can log / surface in cron
/// output.
export async function sendToUser(userId: string, payload: PushPayload): Promise<PushResult> {
  if (!ensureVapid()) return { sent: 0, failed: 0, pruned: 0, reason: "vapid_not_configured" };

  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return { sent: 0, failed: 0, pruned: 0, reason: "no_subscriptions" };

  const body = JSON.stringify(payload);
  let sent = 0, failed = 0, pruned = 0;
  const toPrune: string[] = [];

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
      );
      sent += 1;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      // 404/410 = endpoint gone. Browser uninstalled the SW, the
      // subscription expired, or the user revoked it. Prune.
      if (e.statusCode === 404 || e.statusCode === 410) {
        toPrune.push(s.endpoint);
        pruned += 1;
      } else {
        failed += 1;
      }
    }
  }));

  if (toPrune.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: toPrune } } });
  }

  return { sent, failed, pruned };
}

/// Fan-out helper: send the same payload to every user matching the
/// filter, with at-most-once-per-user delivery. Used by the daily-
/// digest cron. The filter shape mirrors prisma's UserWhereInput so
/// callers can narrow by AlertPreference flags etc.
export async function sendToMany(
  userIds: string[],
  payload: PushPayload,
): Promise<{ users: number; sent: number; failed: number; pruned: number }> {
  let sent = 0, failed = 0, pruned = 0;
  for (const uid of userIds) {
    const r = await sendToUser(uid, payload);
    sent += r.sent;
    failed += r.failed;
    pruned += r.pruned;
  }
  return { users: userIds.length, sent, failed, pruned };
}
