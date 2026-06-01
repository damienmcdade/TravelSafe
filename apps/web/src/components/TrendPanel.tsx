"use client";
import { useEffect, useState } from "react";
import { api, useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { useArea, type AreaSelection } from "@/lib/use-area";
import { SafeZoneAreaPicker } from "@/components/SafeZoneAreaPicker";
import { snapToSupported, useTimeWindow, type WindowValue } from "@/lib/use-time-window";

/// Self-contained Trend panel. Owns its own state (compare, window),
/// reads the global area selection (so it stays in sync with /safety-
/// score and the rest of the app), and fetches /safezone/trend.
///
/// Lifted from /trends/page.tsx during the Option 2 IA restructure —
/// both /safety-score and /trends now render this component so the
/// trend timeline is the same UI from either entry point. /trends
/// still exists as an URL alias / SEO landing point.

// v99 — max dispatch rows rendered to the DOM at once (the feed can return
// thousands; the rest are reachable via Download CSV).
const DISPATCH_RENDER_CAP = 100;
// v104 — cap the bullets pulled for DISPLAY. The uncapped citywide trend
// serialized ~4.5k bullets / ~740KB and was re-fetched on EVERY city / area /
// neighborhood switch — the dominant cost of a slow transition. We render only
// DISPATCH_RENDER_CAP and summarize the rest, so 150 comfortably covers the
// view; the "Download CSV" action fetches the complete set on demand.
const TREND_DISPLAY_BULLETS = 150;

interface TrendBullet {
  kind: "trend" | "dispatch";
  at: string;
  text: string;
  category?: "PERSONS" | "PROPERTY" | "SOCIETY";
}
interface TrendResp {
  city: { slug: string; label: string };
  area: { slug: string; label: string };
  windowStart: string;
  totalIncidents: number;
  bullets: TrendBullet[];
  timeOfDay: {
    buckets: { late_night: number; morning: number; afternoon: number; evening: number };
    dominantPeriod: "late_night" | "morning" | "afternoon" | "evening";
    dominantPct: number;
  } | null;
  source: { label: string; url: string };
  disclaimer: string;
}

// Match the muted gradient the rest of the app uses — terracotta, sand-gold,
// slate-teal. Tailwind utilities don't have these exact tones so we use
// inline style colors via plain hex.
const CAT_DOT: Record<NonNullable<TrendBullet["category"]>, string> = {
  PERSONS:  "bg-[#DC2626]",
  PROPERTY: "bg-[#F59E0B]",
  SOCIETY:  "bg-[#2563EB]",
};

/// `headingLevel` lets the parent control the section heading rank so
/// TrendPanel slots into different hierarchies cleanly: on /trends
/// (its own page) it's h2 under the page's h1; on /safety-score
/// (mounted under ScoreReport's h2) it should be h3 to avoid skipping.
export function TrendPanel({ headingLevel = 2 }: { headingLevel?: 2 | 3 } = {}) {
  const { city } = useCity();
  const { area } = useArea(city.slug);
  const [compareArea, setCompareArea] = useState<AreaSelection | null>(null);
  const [showComparePicker, setShowComparePicker] = useState(false);
  // Window now comes from the shared cross-card store so picking 90 days
  // on CrimeChart propagates here (and vice versa). The TrendPanel's
  // preset set is narrower than CrimeChart's, so we snap to the nearest
  // supported value — the user's actual preference is preserved in the
  // shared store and surfaces again on cards that support it.
  const { value: rawWindow, setValue: setSharedWindow } = useTimeWindow();
  const TREND_PRESETS: ReadonlyArray<WindowValue> = [7, 14, 30, 90];
  const snapped = snapToSupported(rawWindow, TREND_PRESETS);
  const windowDays = typeof snapped === "number" ? snapped : 30;
  const setWindowDays = (d: number) => setSharedWindow(d);
  const HeadingTag = headingLevel === 3 ? "h3" : "h2";
  const headingClass = headingLevel === 3 ? "font-display text-xl text-slate2-900" : "font-display text-2xl text-slate2-900";

  const windowSuffix = `&days=${windowDays}&bullets=${TREND_DISPLAY_BULLETS}`;
  const path = area
    ? `/safezone/trend?area=${encodeURIComponent(area.slug)}&label=${encodeURIComponent(area.label)}${windowSuffix}`
    : `/safezone/trend?city=${encodeURIComponent(city.slug)}${windowSuffix}`;
  const comparePath = compareArea
    ? `/safezone/trend?area=${encodeURIComponent(compareArea.slug)}&label=${encodeURIComponent(compareArea.label)}${windowSuffix}`
    : null;
  const { data: trend, loading, error } = useApi<TrendResp>(path, [path]);
  const { data: compareTrend, loading: compareLoading } = useApi<TrendResp>(comparePath, [comparePath]);

  const compareMode = compareArea !== null;

  return (
    <section id="trends" className="space-y-4 scroll-mt-24">
      <header>
        <HeadingTag className={headingClass}>
          What&apos;s shifted in {area?.label ?? `${city.label} citywide`} over the past {windowDays} days
        </HeadingTag>
        <p className="mt-1 text-sm text-slate2-500 max-w-2xl">
          Rolling timeline of police reports. Same official feed that powers the Crime Map and the Safety Index above.
        </p>
      </header>

      <WindowSelector value={windowDays} onChange={setWindowDays} />

      {loading && !trend && <TrendSkeleton />}
      {error && !loading && (
        <p className="surface p-4 text-sm text-dusk-700">
          Could not load the trend feed for {area?.label ?? `${city.label} citywide`}. The police feed may be warming up — try again in a moment.
        </p>
      )}

      {trend && !loading && (
        <>
          <div className={compareMode ? "grid grid-cols-1 lg:grid-cols-2 gap-4 items-start" : "space-y-4"}>
            <TrendReport trend={trend} csvPath={path} sectionHeadingLevel={headingLevel} windowDays={windowDays} />
            {compareMode && (
              compareTrend
                ? <TrendReport trend={compareTrend} csvPath={comparePath ?? path} accent="compare" sectionHeadingLevel={headingLevel} windowDays={windowDays} />
                : compareLoading
                  ? <TrendSkeleton />
                  : (
                    <p className="surface p-4 text-sm text-dusk-700">
                      Couldn&apos;t load the comparison feed for {compareArea?.label}.
                    </p>
                  )
            )}
          </div>

          <TrendCompareControls
            cityLabel={city.label}
            compareArea={compareArea}
            primarySlug={area?.slug ?? null}
            showPicker={showComparePicker}
            onTogglePicker={() => setShowComparePicker((v) => !v)}
            onPickCompare={(a) => { setCompareArea(a); setShowComparePicker(false); }}
            onClearCompare={() => setCompareArea(null)}
          />

          <p className="surface-muted p-3 text-xs text-slate2-700 leading-snug" role="note">
            <strong className="text-slate2-900">Methodology:</strong> {trend.disclaimer}
          </p>
        </>
      )}
    </section>
  );
}

/// Stateless TrendReport — renders the WoW shift bullets, time-of-day
/// chart, and recent dispatches list for a single TrendResponse.
/// Reused for both the primary view and the compare panel.
function TrendReport({ trend, csvPath, accent, sectionHeadingLevel = 2, windowDays = 30 }: { trend: TrendResp; csvPath: string; accent?: "compare"; sectionHeadingLevel?: 2 | 3; windowDays?: number }) {
  // When the parent panel is at h2, our subsections (Week-over-week
  // shift / Recent dispatches / When reports happen) are h3. When
  // the panel is at h3 (mounted under another h2), we bump our
  // subsections to h4 so the hierarchy stays well-formed.
  const SubHeading = sectionHeadingLevel === 3 ? "h4" : "h3";
  const trendBullets = trend.bullets.filter((b) => b.kind === "trend");
  const dispatchBullets = trend.bullets.filter((b) => b.kind === "dispatch");
  // v75 — Recent dispatches collapsed by default. Aligns with the
  // pattern already wired into AreaBriefPanel / AreaInsightsPanel /
  // NewsPanel / ThreatFeed / CommunitySignalsPanel. Resets to closed
  // when the area changes so each new neighborhood starts clean.
  const [dispatchesOpen, setDispatchesOpen] = useState(false);
  useEffect(() => { setDispatchesOpen(false); }, [trend.area.slug]);
  return (
    <section className="space-y-3">
      {accent === "compare" && (
        <span className="inline-block text-[11px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full bg-bay-100 text-bay-700">
          Comparison
        </span>
      )}
      {trendBullets.length > 0 && (
        <section className="surface p-5 bg-gradient-to-br from-white to-bay-50">
          <header className="flex items-baseline justify-between flex-wrap gap-2">
            <SubHeading className="font-display text-lg text-slate2-900">Week-over-week shift</SubHeading>
            <span className="text-xs text-slate2-500">{trend.area.label}</span>
          </header>
          <ul className="mt-3 space-y-2">
            {trendBullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate2-700">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${b.category ? CAT_DOT[b.category] : "bg-slate2-400"}`} />
                <span>{b.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {trend.timeOfDay && (
        <TimeOfDayChart data={trend.timeOfDay} areaLabel={trend.area.label} headingTag={SubHeading} windowDays={windowDays} />
      )}

      <section className="surface p-5">
        <button
          type="button"
          onClick={() => setDispatchesOpen(!dispatchesOpen)}
          aria-expanded={dispatchesOpen}
          className="w-full flex items-baseline justify-between flex-wrap gap-2 text-left hover:bg-bay-50/40 rounded-md -m-1 p-1 transition-colors"
        >
          <span className="flex items-baseline gap-2 min-w-0">
            <span aria-hidden="true" className={`inline-block transition-transform text-slate2-500 text-sm shrink-0 ${dispatchesOpen ? "rotate-90" : ""}`}>▶</span>
            <SubHeading className="font-display text-lg text-slate2-900 truncate">Recent dispatches in {trend.area.label}</SubHeading>
          </span>
          <span className="text-xs text-slate2-500 shrink-0">{trend.totalIncidents.toLocaleString()} in last {windowDays} days</span>
        </button>

        {dispatchesOpen && (
          <>
            {dispatchBullets.length > 0 && (
              <div className="mt-2 flex justify-end">
                <button
                  onClick={() => downloadDispatchCsv(csvPath, trend, dispatchBullets)}
                  className="text-xs text-bay-700 hover:underline"
                  aria-label="Download dispatches as CSV"
                >
                  Download CSV
                </button>
              </div>
            )}
            {dispatchBullets.length === 0 ? (
              <p className="mt-3 text-sm text-slate2-500">
                {/* v64 — was hardcoded "past 30 days" even when the window
                    picker was set to 7d / 90d / 180d. User trust hit when
                    the label and the actual window diverged. */}
                No dispatches in the past {windowDays} days for this neighborhood — that&apos;s normal for many areas in any given month.
              </p>
            ) : (
              <ol className="mt-3 space-y-1.5">
                {/* v99 — cap the rendered DOM. The trend API can return
                    thousands of dispatch bullets; rendering them all (the
                    list was uncapped) blows up reconciliation and layout for
                    a list that's mostly off-screen. Show the most-recent 100;
                    the full set is still one click away via Download CSV. */}
                {dispatchBullets.slice(0, DISPATCH_RENDER_CAP).map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate2-700">
                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${b.category ? CAT_DOT[b.category] : "bg-slate2-400"}`} />
                    <span>{b.text}</span>
                  </li>
                ))}
                {dispatchBullets.length > DISPATCH_RENDER_CAP && (
                  <li className="text-xs text-slate2-500 pt-1">
                    Showing the {DISPATCH_RENDER_CAP} most recent — use Download CSV for the complete list.
                  </li>
                )}
              </ol>
            )}
            <p className="mt-4 text-xs text-slate2-500">
              Source:{" "}
              <a href={trend.source.url} target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">
                {trend.source.label}
              </a>
            </p>
          </>
        )}
      </section>
    </section>
  );
}

function WindowSelector({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const presets: Array<{ label: string; days: number }> = [
    { label: "7 days",  days: 7  },
    { label: "14 days", days: 14 },
    { label: "30 days", days: 30 },
    { label: "90 days", days: 90 },
  ];
  return (
    <div className="surface-muted px-4 py-2.5 flex items-center justify-between flex-wrap gap-2 text-xs">
      <span className="text-slate2-700 font-medium">Window:</span>
      <div className="flex gap-1">
        {presets.map((p) => (
          <button
            key={p.days}
            onClick={() => onChange(p.days)}
            className={`px-2.5 py-1 rounded-md transition-colors ${
              value === p.days
                ? "bg-bay-500 text-white"
                : "text-slate2-700 hover:bg-bay-100"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TrendCompareControls({
  cityLabel, compareArea, primarySlug, showPicker,
  onTogglePicker, onPickCompare, onClearCompare,
}: {
  cityLabel: string;
  compareArea: AreaSelection | null;
  primarySlug: string | null;
  showPicker: boolean;
  onTogglePicker: () => void;
  onPickCompare: (a: AreaSelection | null) => void;
  onClearCompare: () => void;
}) {
  if (compareArea) {
    return (
      <div className="flex items-center justify-between flex-wrap gap-2 surface-muted px-4 py-3">
        <p className="text-sm text-slate2-700">
          Comparing against <strong className="text-slate2-900">{compareArea.label}</strong>.
        </p>
        <button onClick={onClearCompare} className="text-xs text-bay-700 hover:underline">
          ← End comparison
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <button
        onClick={onTogglePicker}
        className="text-sm text-bay-700 hover:underline font-medium"
      >
        {showPicker ? "− Hide compare picker" : "+ Compare trends with another neighborhood"}
      </button>
      {showPicker && (
        <SafeZoneAreaPicker
          storageKey="trend-feed.compare"
          onCommit={onPickCompare}
          selectedSlug={null}
          title={`Pick another ${cityLabel} neighborhood to compare`}
          subtitle={primarySlug
            ? `The first neighborhood stays in the left column; this pick lands on the right.`
            : `Currently showing ${cityLabel} citywide on the left; this pick lands on the right.`}
          commitLabel="Compare this neighborhood"
          autoCommit={false}
        />
      )}
    </div>
  );
}

/// Escape one CSV cell — wrap in quotes when it contains a comma, quote,
/// or newline; double-quote any internal quotes. RFC 4180 style.
function csvEscape(v: string): string {
  if (v.includes(",") || v.includes("\"") || v.includes("\n") || v.includes("\r")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

/// Build and trigger a browser download of the current dispatch bullets
/// as a CSV file. The bullets carry timestamp, category, and the
/// human-readable text — the latter already includes the offense
/// description and block label.
async function downloadDispatchCsv(csvPath: string, trend: TrendResp, loaded: TrendBullet[]) {
  if (typeof window === "undefined") return;
  // The panel only loads ~150 bullets for display; pull the COMPLETE dispatch
  // list on demand here (bump the bullets cap to the server max). Fall back to
  // whatever's already loaded if the fetch fails.
  let dispatches = loaded;
  try {
    const full = await api<TrendResp>(csvPath.replace(/([?&]bullets=)\d+/, "$15000"));
    const complete = full.bullets.filter((b) => b.kind === "dispatch");
    if (complete.length) dispatches = complete;
  } catch { /* offline / slow — use the already-loaded subset */ }
  const header = ["timestamp", "category", "description"];
  const rows = dispatches.map((b) => [
    new Date(b.at).toISOString(),
    b.category ?? "",
    b.text,
  ]);
  const lines = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + lines], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const slug = trend.area.slug.replace(/[^a-z0-9-]+/gi, "-");
  a.download = `travelsafe-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const PERIOD_META: Record<NonNullable<TrendResp["timeOfDay"]>["dominantPeriod"], { label: string; sublabel: string; tone: string }> = {
  late_night: { label: "Late night", sublabel: "12am – 6am", tone: "#2563EB" },
  morning:    { label: "Morning",    sublabel: "6am – 12pm", tone: "#7BA86E" },
  afternoon:  { label: "Afternoon",  sublabel: "12pm – 6pm", tone: "#F59E0B" },
  evening:    { label: "Evening",    sublabel: "6pm – 12am", tone: "#DC2626" },
};

function TimeOfDayChart({ data, areaLabel, headingTag: H = "h3", windowDays = 30 }: {
  data: NonNullable<TrendResp["timeOfDay"]>;
  areaLabel: string;
  headingTag?: "h3" | "h4";
  windowDays?: number;
}) {
  const total =
    data.buckets.late_night + data.buckets.morning + data.buckets.afternoon + data.buckets.evening;
  if (total === 0) return null;
  const rows: Array<{ key: keyof typeof data.buckets; n: number }> = [
    { key: "late_night", n: data.buckets.late_night },
    { key: "morning",    n: data.buckets.morning },
    { key: "afternoon",  n: data.buckets.afternoon },
    { key: "evening",    n: data.buckets.evening },
  ];
  const max = Math.max(...rows.map((r) => r.n)) || 1;
  return (
    <section className="surface p-5 bg-gradient-to-br from-white to-sand-50">
      <header className="flex items-baseline justify-between flex-wrap gap-1">
        <H className="font-display text-lg text-slate2-900">When reports happen</H>
        <span className="text-xs text-slate2-500">{areaLabel} · {windowDays}-day window</span>
      </header>
      <p className="mt-1 text-xs text-slate2-500">
        Hourly distribution of every report in the window, bucketed into four six-hour periods.
        Useful for thinking about when activity is most likely vs. quiet.
      </p>
      <ul className="mt-4 space-y-2.5">
        {rows.map(({ key, n }) => {
          const meta = PERIOD_META[key];
          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
          const widthPct = (n / max) * 100;
          const dominant = key === data.dominantPeriod;
          return (
            <li key={key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ background: meta.tone }} />
                  <span className={`${dominant ? "font-medium text-slate2-900" : "text-slate2-700"}`}>{meta.label}</span>
                  <span className="text-[11px] text-slate2-500">{meta.sublabel}</span>
                </span>
                <span className={`text-xs tabular-nums ${dominant ? "text-slate2-900 font-medium" : "text-slate2-500"}`}>
                  {n.toLocaleString()} · {pct}%
                </span>
              </div>
              <div className={`mt-1 h-2 rounded-full bg-sand-100 overflow-hidden ${dominant ? "ring-1 ring-bay-200" : ""}`}>
                <div
                  className="h-full transition-all duration-700"
                  style={{ width: `${widthPct}%`, background: meta.tone }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-[11px] text-slate2-500">
        Dominant period: <strong className="text-slate2-700">{PERIOD_META[data.dominantPeriod].label} ({PERIOD_META[data.dominantPeriod].sublabel})</strong> with {data.dominantPct}% of reports.
      </p>
    </section>
  );
}

function TrendSkeleton() {
  return (
    <>
      <section className="surface p-5 space-y-2">
        <div className="skel h-4 w-1/3" />
        <div className="skel h-3 w-2/3" />
        <div className="skel h-3 w-1/2" />
      </section>
      <section className="surface p-5 space-y-2">
        <div className="skel h-4 w-1/2" />
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skel h-3 w-full" />)}
      </section>
    </>
  );
}
