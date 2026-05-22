"use client";
import { useEffect, useRef, useState } from "react";
import { useCommunityStream } from "@/lib/sse";

export function LiveActivityBadge() {
  const [pulse, setPulse] = useState(false);
  const [lastEvent, setLastEvent] = useState<Date | null>(null);
  // Track the pulse-off timer so rapid back-to-back stream events don't
  // leak timers and so we can cancel the pending clear on unmount.
  const pulseTimer = useRef<number | null>(null);

  useCommunityStream((e) => {
    if (e.type === "post.verified" || e.type === "post.reverted") {
      setLastEvent(new Date());
      setPulse(true);
      if (pulseTimer.current != null) window.clearTimeout(pulseTimer.current);
      pulseTimer.current = window.setTimeout(() => {
        setPulse(false);
        pulseTimer.current = null;
      }, 1500);
    }
  });

  useEffect(() => {
    return () => {
      if (pulseTimer.current != null) window.clearTimeout(pulseTimer.current);
    };
  }, []);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate2-500">
      <span className={`relative inline-flex w-2 h-2`}>
        <span className={`absolute inset-0 rounded-full bg-sage-500 ${pulse ? "animate-ping" : ""}`} />
        <span className="relative inline-flex w-2 h-2 rounded-full bg-sage-500" />
      </span>
      Live
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
