import { EventEmitter } from "node:events";

// In-process pub/sub for live community updates (SSE subscribers).
// TODO: swap for Redis pub/sub when running >1 Railway instance.
export const communityEvents = new EventEmitter();
communityEvents.setMaxListeners(200);

export type CommunityEvent =
  | { type: "post.verified"; postId: string; areaSlug: string; kind: string; reviewedAt: string }
  | { type: "post.reverted"; postId: string; areaSlug: string };
