"use client";
import { useEffect, useState } from "react";
import type { BaselinePoint, ThreatConfidence, ThreatItem } from "./types";
import { api } from "@/lib/api-client";

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

// Per-confidence badge styling. Uses the muted palette tokens
// already in the design system so badges sit alongside the other
// chips/pills without competing for attention. Title attribute
// carries the full description so users hovering the badge get
// the trust rationale.
const CONFIDENCE_BADGE: Record<ThreatConfidence, { label: string; cls: string; title: string }> = {
  verified: {
    label: "Verified",
    cls: "bg-sage-100 text-sage-700 ring-sage-200",
    title: "From an official police data feed; report has stabilized (older than 2 hours).",
  },
  "community-confirmed": {
    label: "Community confirmed",
    cls: "bg-bay-100 text-bay-700 ring-bay-200",
    title: "Multiple community signals OR moderator-approved community post.",
  },
  developing: {
    label: "Developing",
    cls: "bg-amber2-50 text-amber2-700 ring-amber2-300",
    title: "Fresh initial report (under 2 hours old) — description may be revised as the case file is updated.",
  },
  unverified: {
    label: "Unverified",
    cls: "bg-sand-100 text-slate2-500 ring-sand-300",
    title: "Single community signal, not yet reviewed by a moderator.",
  },
};

// Default visible rows. The previous FEED_CAP of 12 made the panel
// dominate the analytics column and threw off the column-height
// balance with the right-side news/alerts. Users who want the full
// recent window can expand via the disclosure below.
const DEFAULT_VISIBLE = 5;
const HARD_CAP = 50;

/// Stateless presentation widget. Renders a chronological list of sanitized
/// dispatches; if the list is empty for the active window, falls back to
/// the analytical baseline chart instead of an empty textual line.
export function ThreatFeed({ threats, baseline, windowDays, contextLabel, source, loading }: ThreatFeedProps) {
  const [expanded, setExpanded] = useState(false);
  if (loading && threats.length === 0) return <ThreatFeedSkeleton />;
  // Hard cap on what we'll ever render — even when expanded — so the
  // page can't blow up if an adapter returns thousands of rows.
  const eligible = threats.slice(0, HARD_CAP);
  const visible = expanded ? eligible : eligible.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = eligible.length - visible.length;

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
            No reported dispatches in the past {windowDays} days.
          </p>
        </div>
      ) : (
        <>
          <ol className="mt-3 space-y-1.5">
            {visible.map((t) => {
              const badge = CONFIDENCE_BADGE[t.confidence];
              return <IncidentRow key={t.id} description={t.description} categoryDot={CAT_DOT[t.category]} badge={badge} confidence={t.confidence} />;
            })}
          </ol>
          {(hiddenCount > 0 || expanded) && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              className="mt-3 text-xs text-bay-700 hover:underline"
            >
              {expanded
                ? `Show fewer (back to ${DEFAULT_VISIBLE})`
                : `Show ${hiddenCount} more ${hiddenCount === 1 ? "dispatch" : "dispatches"}${threats.length > HARD_CAP ? ` (of ${threats.length} total)` : ""}`}
            </button>
          )}
        </>
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

/// Click-to-explain confidence badge. The badge itself shows the
/// short label; clicking opens a popover with the full rationale.
/// Provides the "confidence explanation modal" the strategy doc
/// asked for, scoped per-row so users can interrogate any
/// individual incident's trust signal without leaving the feed.
function ConfidenceBadge({
  confidence,
  label,
  cls,
  title,
}: {
  confidence: ThreatConfidence;
  label: string;
  cls: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={`Explain ${label} confidence rating`}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`text-[10px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded-full ring-1 ${cls} hover:opacity-90 transition-opacity cursor-pointer`}
        title={title}
      >
        {label}
      </button>
      {open && (
        <>
          {/* Transparent backdrop swallows outside clicks. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default bg-transparent"
          />
          <div
            role="dialog"
            aria-label={`${label} confidence explanation`}
            className="absolute z-40 right-0 top-6 w-72 max-w-[calc(100vw-2rem)] surface p-3 text-xs leading-snug shadow-lg ring-1 ring-sand-300"
          >
            <p className="font-medium text-slate2-900">{label} confidence</p>
            <p className="mt-1 text-slate2-700">{title}</p>
            <p className="mt-2 text-[10px] text-slate2-500 leading-snug">
              Confidence combines source credibility, report age, and clustering with peer incidents in the same category within 24 hours. A fresh report stays &ldquo;developing&rdquo; until either 2+ same-category peers corroborate it or 2 hours pass.
            </p>
            <ConfidenceLevelGuide active={confidence} />
          </div>
        </>
      )}
    </span>
  );
}

function ConfidenceLevelGuide({ active }: { active: ThreatConfidence }) {
  const levels: Array<{ id: ThreatConfidence; label: string; copy: string }> = [
    { id: "verified", label: "Verified", copy: "Official feed + report stabilized (>2h or clustered)." },
    { id: "community-confirmed", label: "Community confirmed", copy: "Multi-signal community post or moderator-approved." },
    { id: "developing", label: "Developing", copy: "Fresh adapter row (<2h); description may be revised." },
    { id: "unverified", label: "Unverified", copy: "Single community signal, not yet moderated." },
  ];
  return (
    <ul className="mt-3 space-y-1.5 text-[11px]">
      {levels.map((l) => (
        <li key={l.id} className={`flex items-baseline gap-1.5 ${l.id === active ? "text-slate2-900" : "text-slate2-500"}`}>
          <span className="font-medium shrink-0">{l.label}{l.id === active ? " ✓" : ""}</span>
          <span>{l.copy}</span>
        </li>
      ))}
    </ul>
  );
}

/// One incident row + its inline "Explain" expansion. Click the
/// Explain link to fetch a plain-language definition of the offense
/// category. Strictly opt-in (one LLM call per click), and the server
/// caches by description so repeat clicks across rows with the same
/// offense — and across users — are free after the first.
function IncidentRow({
  description,
  categoryDot,
  badge,
  confidence,
}: {
  description: string;
  categoryDot: string;
  badge: { label: string; cls: string; title: string };
  confidence: ThreatConfidence;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (explanation != null || loading) {
      setOpen(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ explanation: string | null; aiConfigured: boolean }>(
        `/ai/incident-explain?desc=${encodeURIComponent(description)}`,
      );
      if (!r.aiConfigured) setError("AI is not configured for this deployment.");
      else if (!r.explanation) setError("No explanation available.");
      else setExplanation(r.explanation);
      setOpen(true);
    } catch (e) {
      setError((e as Error).message || "Couldn't explain this offense right now.");
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <li className="text-sm text-slate2-700">
      <div className="flex items-start gap-2 flex-wrap sm:flex-nowrap">
        <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${categoryDot}`} aria-hidden />
        <span className="flex-1 min-w-0">{description}</span>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          aria-label={`Explain "${description}"`}
          aria-expanded={open}
          className="text-[10px] uppercase tracking-wider text-slate2-500 hover:text-bay-700 underline-offset-2 hover:underline whitespace-nowrap disabled:opacity-50 disabled:cursor-wait shrink-0"
        >
          {loading ? "Loading…" : open ? "Hide" : "Explain"}
        </button>
        <ConfidenceBadge confidence={confidence} label={badge.label} cls={badge.cls} title={badge.title} />
      </div>
      {open && (
        <div className="mt-1.5 ml-4 surface-muted p-2.5 text-xs text-slate2-700 leading-snug">
          {explanation && <p>{explanation}</p>}
          {error && <p className="text-amber2-700">{error}</p>}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-1.5 text-[10px] uppercase tracking-wider text-bay-700 hover:underline"
          >
            Close
          </button>
        </div>
      )}
    </li>
  );
}
