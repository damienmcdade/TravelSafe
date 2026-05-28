import webpush from "web-push";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../env.js";

// Web Push fan-out helpers. Ported from apps/web's webpush.ts so the
// digest worker can run on Railway without a network round-trip back
// to Vercel. Same VAPID config (CommunitySafe owns one keypair shared
// across both runtimes).

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
  data?: Record<string, unknown>;
}

export interface PushResult {
  sent: number;
  failed: number;
  pruned: number;
  reason?: string;
}

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
      const e = err as { statusCode?: number };
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

export async function sendToMany(
  userIds: string[],
  payload: PushPayload,
): Promise<{ users: number; sent: number; failed: number; pruned: number }> {
  if (userIds.length === 0) return { users: 0, sent: 0, failed: 0, pruned: 0 };
  if (!ensureVapid()) return { users: userIds.length, sent: 0, failed: 0, pruned: 0 };

  // v96 — was N sequential findMany calls (one per user). On a digest
  // fan-out to 10k users that's 10k DB roundtrips. Batch-fetch every
  // subscription in a single query, group by userId in memory, then
  // dispatch in parallel.
  const allSubs = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, endpoint: true, p256dh: true, auth: true },
  });
  if (allSubs.length === 0) return { users: userIds.length, sent: 0, failed: 0, pruned: 0 };

  const body = JSON.stringify(payload);
  let sent = 0, failed = 0, pruned = 0;
  const toPrune: string[] = [];

  // v96 — per-endpoint timeout. A few push service endpoints
  // (mostly dead Firefox + iOS Safari ones) hang the underlying
  // TLS connect rather than 4xx. web-push doesn't expose a per-call
  // timeout option, so race each call against a 10 s deadline. A
  // hung endpoint counts as "failed" but doesn't stall the whole
  // digest fan-out (was previously holding the entire daily digest
  // hostage until web-push's internal default timed out).
  const PUSH_TIMEOUT_MS = 10_000;
  await Promise.all(allSubs.map(async (s) => {
    try {
      await Promise.race([
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("push_timeout")), PUSH_TIMEOUT_MS),
        ),
      ]);
      sent += 1;
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
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

  return { users: userIds.length, sent, failed, pruned };
}
