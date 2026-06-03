"use client";
import { useEffect, useRef, useState } from "react";
import { useCommunityStream } from "@/lib/sse";

export function LiveActivityBadge() {
  const [pulse, setPulse] = useState(false);
  const [lastEvent, setLastEvent] = useState<Date | null>(null);
  // fix(audit ui-cards-2): reflect the REAL stream state. The dot was hardcoded
  // green "Live" even when the SSE connection was down. Start as not-yet-connected
  // and flip on the stream's open/error.
  const [connected, setConnected] = useState(false);
  // Track the pulse-off timer so rapid back-to-back stream events don't
  // leak timers and so we can cancel the pending clear on unmount.
  const pulseTimer = useRef<number | null>(null);

  useCommunityStream(
    (e) => {
      if (e.type === "post.verified" || e.type === "post.reverted") {
        setLastEvent(new Date());
        setPulse(true);
        if (pulseTimer.current != null) window.clearTimeout(pulseTimer.current);
        pulseTimer.current = window.setTimeout(() => {
          setPulse(false);
          pulseTimer.current = null;
        }, 1500);
      }
    },
    setConnected,
  );

  useEffect(() => {
    return () => {
      if (pulseTimer.current != null) window.clearTimeout(pulseTimer.current);
    };
  }, []);

  const dot = connected ? "bg-sage-500" : "bg-slate2-400";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate2-500">
      <span className={`relative inline-flex w-2 h-2`}>
        <span className={`absolute inset-0 rounded-full ${dot} ${pulse ? "animate-ping" : ""}`} />
        <span className={`relative inline-flex w-2 h-2 rounded-full ${dot}`} />
      </span>
      {connected ? "Live" : "Connecting…"}
      {lastEvent && <span>· last update {timeAgo(lastEvent)}</span>}
    </span>
  );
}

function timeAgo(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}
