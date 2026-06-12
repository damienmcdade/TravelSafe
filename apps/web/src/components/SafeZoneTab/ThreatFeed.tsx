"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BaselinePoint, ThreatConfidence, ThreatItem } from "./types";
import { api } from "@/lib/api-client";
import { snapToSupported, useTimeWindow, type WindowValue } from "@/lib/use-time-window";

export interface ThreatFeedProps {
  /// Chronological sanitized incidents for recent reports, newest first.
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
  /// Opt-in: render the panel expanded on first paint (and keep it open
  /// across area/city switches). Defaults to false so existing surfaces
  /// (e.g. Community) keep the collapsed-on-landing behavior.
  defaultOpen?: boolean;
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
    title: "From an official police source and more than 2 hours old, so the details are settled.",
  },
  "community-confirmed": {
    label: "Community confirmed",
    cls: "bg-bay-100 text-bay-700 ring-bay-200",
    title: "Backed up by several neighbors, or a post a moderator has approved.",
  },
  developing: {
    label: "Developing",
    cls: "bg-amber2-50 text-amber2-700 ring-amber2-300",
    title: "Just reported (under 2 hours old). The details may still change as police update it.",
  },
  unverified: {
    label: "Unverified",
    cls: "bg-sand-100 text-slate2-500 ring-sand-300",
    title: "Reported by one neighbor and not yet checked by a moderator.",
  },
};

// Cap how many we'll ever render in a single scroll container — the
// adapter can return thousands of rows for a large window and DOM
// node count matters.
// v95p18 — raised 200 → 2000 per user directive to include every
// event in the selected interval. A 90-day busy-neighborhood window
// can exceed 1500 events; 2000 gives that comfortable headroom while
// keeping the DOM under React's scroll-virtualization threshold.
const HARD_CAP = 2000;

// Window presets the in-card selector exposes. Tied to the shared
// useTimeWindow store so picking a window here drives every other
// window-aware card (CrimeChart, TrendPanel) too.
const WINDOW_PRESETS: ReadonlyArray<WindowValue> = [7, 14, 30, 90];

/// Stateless presentation widget. Renders a chronological list of
/// sanitized dispatches in a scrollable container. Default ~5 rows
/// visible; remaining rows scroll within the panel so users see the
/// whole window without the panel monopolizing the page.
export function ThreatFeed({ threats, windowDays, contextLabel, source, loading, defaultOpen = false }: ThreatFeedProps) {
  // In-card time-interval picker — uses the same shared store that
  // drives CrimeChart and TrendPanel so picking here propagates
  // app-wide. Snapped to ThreatFeed's preset list (which is also
  // TrendPanel's) so users can switch between 7 / 14 / 30 / 90 days.
  const { value: rawWindow, setValue: setSharedWindow } = useTimeWindow();
  const snapped = snapToSupported(rawWindow, WINDOW_PRESETS);
  const selectedWindow = typeof snapped === "number" ? snapped : 30;
  // v70 — panel-level collapse so the dispatch list doesn't dominate
  // the page on landing. Mirrors AreaBriefPanel + NewsPanel pattern.
  // Resets to closed when contextLabel changes (= user picked a
  // different area/city).
  const [panelOpen, setPanelOpen] = useState(defaultOpen);
  useEffect(() => { setPanelOpen(defaultOpen); }, [contextLabel, defaultOpen]);

  if (loading && threats.length === 0) return <ThreatFeedSkeleton />;
  const eligible = threats.slice(0, HARD_CAP);

  return (
    <section className="surface p-4 sm:p-5">
      <button
        type="button"
        onClick={() => setPanelOpen(!panelOpen)}
        aria-expanded={panelOpen}
        className="w-full flex items-center justify-between gap-3 text-left hover:bg-bay-50/40 rounded-md -m-1 p-1 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden="true" className={`inline-block transition-transform text-slate2-500 text-sm shrink-0 ${panelOpen ? "rotate-90" : ""}`}>▶</span>
          <div className="min-w-0">
            <h3 className="font-display text-lg text-slate2-900 truncate">Local Activity</h3>
            <p className="text-xs text-slate2-500 mt-0.5 truncate">{contextLabel}</p>
          </div>
        </div>
        <span className="text-xs text-slate2-500 tabular-nums shrink-0">
          {threats.length === 0 ? "0 reports" : `${threats.length} reports`}
        </span>
      </button>
      {!panelOpen ? null : <>
      <header className="mt-3 flex items-baseline justify-between flex-wrap gap-2">
        <span className="sr-only">Local Activity controls</span>
      </header>

      {/* In-card window selector — pick how much activity to populate.
          Bay-pill matches the rest of the system; writes go to the
          shared useTimeWindow store so the parent useSafeZoneData
          hook re-fetches with the new windowDays. */}
      <div className="mt-3 flex items-center gap-1.5 text-xs" role="radiogroup" aria-label="Local Activity window">
        <span className="text-slate2-500 uppercase tracking-wider text-[11px] mr-1">Window:</span>
        {WINDOW_PRESETS.map((p) => {
          const days = typeof p === "number" ? p : 30;
          const active = days === selectedWindow;
          return (
            <button
              key={String(p)}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setSharedWindow(p)}
              className={`px-2 py-1 rounded-md transition-colors ${
                active
                  ? "bg-bay-500 text-white font-semibold"
                  : "text-slate2-700 hover:bg-bay-100"
              }`}
            >
              {days}d
            </button>
          );
        })}
      </div>

      {eligible.length === 0 ? (
        <div className="mt-4">
          <p className="text-sm text-slate2-700">
            No reports in the past {windowDays} days.
          </p>
        </div>
      ) : (
        <ol
          className="mt-3 max-h-72 overflow-y-auto pr-1 space-y-1.5 [scrollbar-width:thin]"
          aria-label={`${eligible.length} reports over the last ${windowDays} days, scroll to see more`}
        >
          {eligible.map((t) => {
            const badge = CONFIDENCE_BADGE[t.confidence];
            return <IncidentRow key={t.id} description={t.description} categoryDot={CAT_DOT[t.category]} badge={badge} confidence={t.confidence} />;
          })}
        </ol>
      )}

      <p className="mt-4 text-[11px] text-slate2-500">
        Source:{" "}
        <a href={source.url} target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">
          {source.label}
        </a>
      </p>
      </>}
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
const POPOVER_W = 288; // matches w-72 (18rem) — used for viewport clamping

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
  const btnRef = useRef<HTMLButtonElement>(null);
  // fix(confidence-popover-clipped): the popover was `position: absolute`
  // inside the ThreatFeed's `<ol max-h-72 overflow-y-auto>` scroll box, so
  // the overflow clipped it — clicking the badge opened a popover that was
  // cut off / invisible for every row except (partly) the top one, while the
  // fixed full-screen backdrop silently swallowed the next click. The badge
  // read as dead app-wide. Now rendered in a portal at document.body with
  // fixed positioning computed from the trigger rect, so it escapes the
  // scroll clip and every stacking context.
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    function place() {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const margin = 8;
      const left = Math.max(margin, Math.min(r.right - POPOVER_W, window.innerWidth - POPOVER_W - margin));
      setCoords({ top: r.bottom + 6, left });
    }
    place();
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    // Reposition (don't close) while the page/feed scrolls, so the fixed popover
    // tracks its badge. fix(audit badge-scroll-dismiss): the prior handler CLOSED
    // on any scroll — but on touch devices a tap commonly emits a 1px scroll (and
    // the page settles a pixel when the portal mounts), so the popover opened and
    // instantly vanished, reading as a dead "Verified" button. Re-place on scroll
    // instead; only an explicit outside-click / Escape / resize dismisses. If the
    // badge scrolls out of view, hide so a detached popover doesn't linger.
    function onScroll() {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) { setOpen(false); return; }
      place();
    }
    function onResize() { setOpen(false); }
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <span className="inline-flex shrink-0">
      <button
        ref={btnRef}
        type="button"
        aria-label={`Explain ${label} confidence rating`}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`text-[11px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded-full ring-1 ${cls} hover:opacity-90 transition-opacity cursor-pointer`}
        title={title}
      >
        {label}
      </button>
      {open && coords && typeof document !== "undefined" && createPortal(
        <>
          {/* Transparent backdrop swallows outside clicks. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[60] cursor-default bg-transparent"
          />
          <div
            role="dialog"
            aria-label={`${label} confidence explanation`}
            style={{ position: "fixed", top: coords.top, left: coords.left, width: POPOVER_W }}
            className="z-[61] max-w-[calc(100vw-1rem)] surface p-3 text-xs leading-snug shadow-lg ring-1 ring-sand-300"
          >
            <p className="font-medium text-slate2-900">{label} confidence</p>
            <p className="mt-1 text-slate2-700">{title}</p>
            <p className="mt-2 text-[11px] text-slate2-500 leading-snug">
              Confidence looks at where the report came from, how old it is, and whether similar reports nearby back it up within 24 hours. A new report stays &ldquo;developing&rdquo; until either two similar reports back it up or 2 hours pass.
            </p>
            <ConfidenceLevelGuide active={confidence} />
          </div>
        </>,
        document.body,
      )}
    </span>
  );
}

function ConfidenceLevelGuide({ active }: { active: ThreatConfidence }) {
  const levels: Array<{ id: ThreatConfidence; label: string; copy: string }> = [
    { id: "verified", label: "Verified", copy: "From an official source and settled (over 2 hours old or backed up)." },
    { id: "community-confirmed", label: "Community confirmed", copy: "Backed by several neighbors or approved by a moderator." },
    { id: "developing", label: "Developing", copy: "Just reported (under 2 hours old); details may still change." },
    { id: "unverified", label: "Unverified", copy: "Reported by one neighbor, not yet checked." },
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

/// fix(audit explain-unrecognized): the bullet text is a full formatted line
/// ("Wed, Jun 10 · Riverwest — Simple Assault near 3518 N 38TH ST."), but the
/// explainer's prompt expects ONE offense description ("SIMPLE ASSAULT").
/// Sending the whole line made the model refuse with its literal "Not a
/// recognizable offense description." sentinel across many cities (and long
/// lines even tripped the route's 200-char cap). Extract just the offense:
/// our trend-feed composes bullets as "{date}[ · {area}] — {offense}[ near
/// {block}]." with an em-dash separator, so strip the prefix and the
/// block-address suffix before asking.
function offenseFromBullet(text: string): string {
  const dash = text.indexOf(" — ");
  let s = dash >= 0 ? text.slice(dash + 3) : text;
  const near = s.lastIndexOf(" near ");
  if (near > 0) s = s.slice(0, near);
  return s.replace(/[.\s]+$/, "").trim() || text.slice(0, 200);
}

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
        `/ai/incident-explain?desc=${encodeURIComponent(offenseFromBullet(description))}`,
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

  // Bug fix: the header button always called load(), which inside the
  // open state would short-circuit but still call setOpen(true) —
  // making the "Hide" label visually present but functionally
  // useless. Now the button toggles: when open, it closes; when
  // closed, it loads (which opens after the response).
  function toggle() {
    if (open) { setOpen(false); return; }
    void load();
  }

  return (
    <li className="text-sm text-slate2-700">
      <div className="flex items-start gap-2 flex-wrap sm:flex-nowrap">
        <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${categoryDot}`} aria-hidden />
        <span className="flex-1 min-w-0">{description}</span>
        <button
          type="button"
          onClick={toggle}
          disabled={loading}
          aria-label={open ? `Hide explanation for "${description}"` : `Explain "${description}"`}
          aria-expanded={open}
          className="text-[11px] uppercase tracking-wider text-slate2-500 hover:text-bay-700 underline-offset-2 hover:underline whitespace-nowrap disabled:opacity-50 disabled:cursor-wait shrink-0"
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
            className="mt-1.5 text-[11px] uppercase tracking-wider text-bay-700 hover:underline"
          >
            Close
          </button>
        </div>
      )}
    </li>
  );
}
