import { EventEmitter } from "node:events";
import { getRedis, getRedisSubscriber, isRedisEnabled } from "../../lib/redis";

// Live community updates for SSE subscribers (apps/web/.../community/stream).
//
// `communityEvents` is the LOCAL fan-out: SSE handlers on THIS instance
// subscribe to it. Producers must call publishCommunityEvent() (NOT .emit
// directly) so the event reaches every instance:
//
//   • REDIS_URL set → publish to a Redis channel. A per-instance subscriber
//     (started by ensureCommunitySubscriber) receives it on every instance,
//     including this one, and re-emits locally. This is what makes live
//     updates work under multi-instance fan-out (Vercel Fluid Compute / >1
//     Railway instance) — an emit on instance A reaches an SSE client held
//     open on instance B.
//   • REDIS_URL unset → emit straight to the local EventEmitter (correct for
//     a single warm instance; the prior behavior, preserved as a fail-soft
//     fallback).
//
// To avoid double-delivery we never both local-emit AND publish: with Redis,
// delivery happens solely through the subscriber round-trip (every instance,
// incl the originator); without Redis, solely through the direct local emit.
export const communityEvents = new EventEmitter();
communityEvents.setMaxListeners(200);

export type CommunityEvent =
  | { type: "post.verified"; postId: string; areaSlug: string; kind: string; reviewedAt: string }
  | { type: "post.reverted"; postId: string; areaSlug: string }
  | { type: "comment.created"; postId: string };

const CHANNEL = "community:events";

/// Emit a community event to all SSE subscribers across all instances.
/// Producers call this instead of communityEvents.emit().
export function publishCommunityEvent(evt: CommunityEvent): void {
  const redis = getRedis();
  if (redis) {
    // The subscriber (on every instance, including this one) will re-emit
    // locally — so we do NOT also emit here, or local clients get it twice.
    redis.publish(CHANNEL, JSON.stringify(evt)).catch((err: Error) => {
      // Redis hiccup: don't lose the event for clients on THIS instance.
      console.warn("[community-events] publish failed, local-only:", err.message);
      communityEvents.emit("event", evt);
    });
    return;
  }
  communityEvents.emit("event", evt);
}

// Per-instance subscriber, started once. Idempotent — safe to call on every
// SSE connection. No-op when Redis isn't configured (local emit handles it).
let subscriberStarted = false;
export function ensureCommunitySubscriber(): void {
  if (subscriberStarted || !isRedisEnabled()) return;
  const sub = getRedisSubscriber();
  if (!sub) return;
  subscriberStarted = true;
  sub.subscribe(CHANNEL).catch((err: Error) => {
    console.warn("[community-events] subscribe failed:", err.message);
    subscriberStarted = false; // allow a later retry
  });
  sub.on("message", (_channel: string, payload: string) => {
    try {
      communityEvents.emit("event", JSON.parse(payload) as CommunityEvent);
    } catch {
      /* ignore malformed payloads */
    }
  });
}
