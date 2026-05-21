"use client";
import { useEffect, useRef } from "react";
import { API_BASE } from "./api-client";

export function useCommunityStream(onEvent: (evt: { type: string; [k: string]: unknown }) => void) {
  const ref = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/community/stream`);
    ref.current = es;
    es.onmessage = (m) => {
      try { onEvent(JSON.parse(m.data)); } catch { /* skip malformed */ }
    };
    es.onerror = () => {
      // EventSource auto-reconnects with exponential backoff by default.
    };
    return () => {
      es.close();
      ref.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
