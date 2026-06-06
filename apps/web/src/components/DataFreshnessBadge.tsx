"use client";
import { useEffect, useState } from "react";

interface Props {
  /// ISO timestamp of the **newest published incident** the underlying
  /// adapter has cached. NOT the adapter sync time — a fresh sync against
  /// a stale upstream still yields an old `asOf`. The badge caption
  /// reflects this distinction by saying "newest report" rather than
  /// "synced", so the label honestly describes the timestamp we display.
  asOf: string | null | undefined;
  /// Optional source label for the tooltip — e.g. "SDPD NIBRS".
  sourceLabel?: string;
  /// Visual size. `sm` for inline placement next to card headings;
  /// `md` for hero banners.
  size?: "sm" | "md";
  /// When false, the green check is suppressed (still shows the relative
  /// timestamp). Use for surfaces where the synced-state would be
  /// repetitive after a hero badge already established it.
  showCheck?: boolean;
}

/// Data-freshness trust badge with a relative-time "newest report …"
/// caption. Renders a green check + relative timestamp like
/// "Synced · newest report 4 min ago". The check signals "we have current
/// data" (not "this data has been independently verified"); the caption
/// quotes the recency of the newest published incident in the cache, which
/// is the most honest single proxy for data freshness available to the UI.
/// Hovering or focusing the badge surfaces the exact ISO timestamp +
/// source label as a native tooltip.
///
/// Updates the displayed relative time every 30s without a fetch — the
/// timestamp itself is static; only the "X ago" presentation drifts.
export function DataFreshnessBadge({ asOf, sourceLabel, size = "sm", showCheck = true }: Props) {
  // fix(audit hydration): `now` and the locale/TZ-dependent toLocaleString below
  // differ between the server render and the client, so seeding now=Date.now() in
  // the initializer caused an intermittent React #418. Start null (server + first
  // client render agree → a stable "recently" placeholder), then fill in the real
  // client time after mount. The 30s interval keeps the relative string fresh.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  if (!asOf) return null;
  const t = new Date(asOf);
  if (Number.isNaN(t.getTime())) return null;

  const rel = now != null ? relativeAgo(now - t.getTime()) : "recently";
  const exact = now != null ? t.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
  const title = exact
    ? (sourceLabel ? `Newest report from ${sourceLabel}: ${exact}` : `Newest report in the cache: ${exact}`)
    : (sourceLabel ? `Newest report from ${sourceLabel}` : "Newest report in the cache");

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
        <span className="font-medium">Synced</span>
        <span className="text-sage-700/80"> · newest report {rel}</span>
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
