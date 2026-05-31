import { EventEmitter } from "node:events";
import { getRedis, getRedisSubscriber, isRedisEnabled } from "../../lib/redis.js";

// Live community updates for SSE subscribers (community.routes.ts /stream).
//
// `communityEvents` is the LOCAL fan-out: SSE handlers on THIS instance
// subscribe to it. Producers must call publishCommunityEvent() (NOT .emit
// directly) so the event reaches SSE clients on every instance:
//
//   • REDIS_URL set → publish to a Redis channel. A per-instance subscriber
//     (started by ensureCommunitySubscriber) receives it on every instance,
//     including this one, and re-emits locally. This is what makes live
//     updates correct when Railway runs >1 instance — an emit handled by
//     instance A reaches an SSE client held open on instance B.
//   • REDIS_URL unset → emit straight to the local EventEmitter (correct for
//     a single instance; the prior behavior, preserved as a fail-soft path).
//
// We never both local-emit AND publish, so clients never get an event twice:
// with Redis, delivery is solely via the subscriber round-trip (every
// instance, incl the originator); without Redis, solely via the local emit.
export const communityEvents = new EventEmitter();
communityEvents.setMaxListeners(200);

export type CommunityEvent =
  | { type: "post.verified"; postId: string; areaSlug: string; kind: string; reviewedAt: string }
  | { type: "post.reverted"; postId: string; areaSlug: string };

const CHANNEL = "community:events";

/// Emit a community event to all SSE subscribers across all instances.
/// Producers call this instead of communityEvents.emit().
export function publishCommunityEvent(evt: CommunityEvent): void {
  const redis = getRedis();
  if (redis) {
    redis.publish(CHANNEL, JSON.stringify(evt)).catch((err: Error) => {
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
