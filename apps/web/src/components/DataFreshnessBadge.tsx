"use client";
import { useEffect, useState } from "react";

interface Props {
  /// ISO timestamp of the most recent successful upstream pull. Most APIs
  /// return this as `asOf`; provenance objects use `recency`. Pass null
  /// when the underlying data is loading or unavailable.
  asOf: string | null | undefined;
  /// Optional source label for the tooltip — e.g. "SDPD NIBRS".
  sourceLabel?: string;
  /// Visual size. `sm` for inline placement next to card headings;
  /// `md` for hero banners.
  size?: "sm" | "md";
  /// When false, the green check is suppressed (still shows the relative
  /// timestamp). Use for surfaces where the verified-state would be
  /// repetitive after a hero badge already established it.
  showCheck?: boolean;
}

/// "Data Verified" trust badge with a relative-time "Synced ..." caption.
/// Renders a green check + relative timestamp like "Verified · synced
/// 4 min ago". Hovering or focusing the badge surfaces the exact ISO
/// timestamp + source label as a native tooltip.
///
/// Updates the displayed relative time every 30s without a fetch — the
/// timestamp itself is static; only the "X ago" presentation drifts.
export function DataFreshnessBadge({ asOf, sourceLabel, size = "sm", showCheck = true }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  if (!asOf) return null;
  const t = new Date(asOf);
  if (Number.isNaN(t.getTime())) return null;

  const rel = relativeAgo(now - t.getTime());
  const exact = t.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const title = sourceLabel
    ? `Last update from ${sourceLabel}: ${exact}`
    : `Last upstream update: ${exact}`;

  const padding = size === "md" ? "px-2.5 py-1" : "px-2 py-0.5";
  const text = size === "md" ? "text-xs" : "text-[11px]";

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full bg-sage-100 ring-1 ring-sage-300 text-sage-700 ${padding} ${text} tabular-nums`}
      aria-label={title}
    >
      {showCheck && (
        <svg
          viewBox="0 0 12 12"
          aria-hidden
          className="w-3 h-3 fill-none stroke-sage-700 stroke-[1.8]"
        >
          <circle cx="6" cy="6" r="5" className="fill-sage-200" />
          <path d="M3.5 6.2 5 7.7 8.5 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <span>
        <span className="font-medium">Verified</span>
        <span className="text-sage-700/80"> · synced {rel}</span>
      </span>
    </span>
  );
}

function relativeAgo(diffMs: number): string {
  const s = Math.max(0, Math.round(diffMs / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d}d ago`;
  // Beyond 2 weeks, pivot to absolute date so users don't lose the calendar context.
  return new Date(Date.now() - diffMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
