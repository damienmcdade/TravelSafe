import type { NextRequest } from "next/server";
import { communityEvents, ensureCommunitySubscriber } from "@/server/services/community/events";

export const dynamic = "force-dynamic";
// v64 — set explicit maxDuration. Without it the function inherits
// the default and the SSE connection drops with a Vercel Runtime
// Timeout Error in the logs. 300s (5 min) is well past the heartbeat
// interval (25s) so clients can reconnect naturally.
export const maxDuration = 300;
// Vercel function streaming: keep the connection open for up to ~5 min.
// In-process EventEmitter only sees events from the same instance; for
// multi-instance scale, swap for Vercel Queues or Redis pub/sub.
export async function GET(_req: NextRequest) {
  // Start the per-instance Redis subscriber (idempotent; no-op without
  // REDIS_URL) so events published on other instances re-emit to the local
  // EventEmitter this stream listens on.
  ensureCommunitySubscriber();
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (data: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      send({ type: "hello", at: new Date().toISOString() });
      const heartbeat = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 25_000);
      const listener = (evt: unknown) => send(evt);
      communityEvents.on("event", listener);
      const cleanup = () => {
        clearInterval(heartbeat);
        communityEvents.off("event", listener);
        try { controller.close(); } catch { /* already closed */ }
      };
      _req.signal.addEventListener("abort", cleanup);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
