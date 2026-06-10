"use client";
import { useEffect, useRef } from "react";
import { API_BASE } from "./api-client";

// fix(perf sse-double-connection + stale-closure): the community page mounts BOTH
// useCommunityStream directly AND <LiveActivityBadge/> (which also calls it), so
// every page view opened TWO long-lived EventSource connections (each = a 270s
// Vercel function invocation). And the old per-hook EventSource captured a stale
// onEvent (empty-deps effect), so after switching neighborhoods the consumer kept
// filtering against the original area. Both are solved by a single shared
// EventSource with a subscriber registry whose callbacks are read live each event.
type StreamSub = {
  onEvent: (evt: { type: string; [k: string]: unknown }) => void;
  onStatus?: (connected: boolean) => void;
};
const subscribers = new Set<StreamSub>();
let sharedES: EventSource | null = null;

function openShared() {
  if (sharedES || typeof window === "undefined") return;
  const es = new EventSource(`${API_BASE}/api/community/stream`);
  sharedES = es;
  es.onopen = () => subscribers.forEach((s) => s.onStatus?.(true));
  es.onmessage = (m) => {
    let data: { type: string; [k: string]: unknown } | null = null;
    try { data = JSON.parse(m.data); } catch { return; }
    subscribers.forEach((s) => s.onEvent(data!));
  };
  // EventSource auto-reconnects after the server's graceful 270s close.
  es.onerror = () => subscribers.forEach((s) => s.onStatus?.(false));
}
function closeSharedIfIdle() {
  if (subscribers.size === 0 && sharedES) {
    sharedES.close();
    sharedES = null;
  }
}

export function useCommunityStream(
  onEvent: (evt: { type: string; [k: string]: unknown }) => void,
  // Optional connection-status callback so a consumer (the LiveActivityBadge) can
  // reflect the REAL stream state. Fires true on open, false on error.
  onStatus?: (connected: boolean) => void,
) {
  // Keep the latest callbacks in a ref so the shared stream always invokes the
  // freshest closure (fixes stale-area filtering after a neighborhood switch).
  const cbRef = useRef<StreamSub>({ onEvent, onStatus });
  cbRef.current = { onEvent, onStatus };

  useEffect(() => {
    const sub: StreamSub = {
      onEvent: (evt) => cbRef.current.onEvent(evt),
      onStatus: (c) => cbRef.current.onStatus?.(c),
    };
    subscribers.add(sub);
    openShared();
    return () => {
      subscribers.delete(sub);
      closeSharedIfIdle();
    };
  }, []);
}

export function relativeTime(iso: string | Date): string {
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
