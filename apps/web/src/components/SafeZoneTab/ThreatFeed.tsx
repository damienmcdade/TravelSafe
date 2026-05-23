"use client";
import type { BaselinePoint, ThreatItem } from "./types";
import { BaselineTrendChart } from "./BaselineTrendChart";

export interface ThreatFeedProps {
  /// Chronological sanitized incidents for the cached window, newest first.
  threats: ThreatItem[];
  /// Weekly bucket counts used as the analytical-baseline fallback when
  /// the threat list is empty for the requested window.
  baseline: BaselinePoint[];
  /// Width of the active window in days (e.g., 30).
  windowDays: number;
  /// Subtitle text shown in the header — typically area or city label.
  contextLabel: string;
  /// Source citation rendered as a tiny link.
  source: { label: string; url: string };
  loading?: boolean;
}

const CAT_DOT: Record<ThreatItem["category"], string> = {
  PERSONS:  "bg-[#DC2626]",
  PROPERTY: "bg-[#F59E0B]",
  SOCIETY:  "bg-[#2563EB]",
};

const FEED_CAP = 12;

/// Stateless presentation widget. Renders a chronological list of sanitized
/// dispatches; if the list is empty for the active window, falls back to
/// the analytical baseline chart instead of an empty textual line.
export function ThreatFeed({ threats, baseline, windowDays, contextLabel, source, loading }: ThreatFeedProps) {
  if (loading && threats.length === 0) return <ThreatFeedSkeleton />;
  const visible = threats.slice(0, FEED_CAP);

  return (
    <section className="surface p-5">
      <header className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-display text-lg text-slate2-900">Local activity — last {windowDays} days</h3>
          <p className="text-xs text-slate2-500 mt-0.5">{contextLabel}</p>
        </div>
        <span className="text-xs text-slate2-500 tabular-nums">
          {threats.length === 0 ? "0 dispatches in window" : `${threats.length} in window`}
        </span>
      </header>

      {visible.length === 0 ? (
        <div className="mt-4">
          <p className="text-sm text-slate2-700">
            No reported dispatches in the past {windowDays} days. The chart below shows the area&apos;s rolling baseline so trends remain visible even during quiet windows.
          </p>
          <div className="mt-3">
            <BaselineTrendChart points={baseline} />
          </div>
        </div>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {visible.map((t) => (
            <li key={t.id} className="flex items-start gap-2 text-sm text-slate2-700">
              <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${CAT_DOT[t.category]}`} aria-hidden />
              <span className="flex-1">{t.description}</span>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-4 text-[11px] text-slate2-500">
        Source:{" "}
        <a href={source.url} target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">
          {source.label}
        </a>
      </p>
    </section>
  );
}

function ThreatFeedSkeleton() {
  return (
    <section className="surface p-5 space-y-2">
      <div className="skel h-4 w-1/2" />
      <div className="skel h-3 w-1/3" />
      <div className="mt-2 space-y-1.5">
        {[0, 1, 2, 3, 4, 5].map((i) => (<div key={i} className="skel h-3 w-full" />))}
      </div>
    </section>
  );
}
