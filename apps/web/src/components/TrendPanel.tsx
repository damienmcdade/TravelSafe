"use client";
import { useState } from "react";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { useArea, type AreaSelection } from "@/lib/use-area";
import { SafeZoneAreaPicker } from "@/components/SafeZoneAreaPicker";

/// Self-contained Trend panel. Owns its own state (compare, window),
/// reads the global area selection (so it stays in sync with /safety-
/// score and the rest of the app), and fetches /safezone/trend.
///
/// Lifted from /trends/page.tsx during the Option 2 IA restructure —
/// both /safety-score and /trends now render this component so the
/// trend timeline is the same UI from either entry point. /trends
/// still exists as an URL alias / SEO landing point.

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

export function TrendPanel() {
  const { city } = useCity();
  const { area } = useArea(city.slug);
  const [compareArea, setCompareArea] = useState<AreaSelection | null>(null);
  const [showComparePicker, setShowComparePicker] = useState(false);
  const [windowDays, setWindowDays] = useState<number>(30);

  const windowSuffix = `&days=${windowDays}`;
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
        <h2 className="font-display text-2xl text-slate2-900">
          What&apos;s shifted in {area?.label ?? `${city.label} citywide`} over the past {windowDays} days
        </h2>
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
            <TrendReport trend={trend} />
            {compareMode && (
              compareTrend
                ? <TrendReport trend={compareTrend} accent="compare" />
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
function TrendReport({ trend, accent }: { trend: TrendResp; accent?: "compare" }) {
  const trendBullets = trend.bullets.filter((b) => b.kind === "trend");
  const dispatchBullets = trend.bullets.filter((b) => b.kind === "dispatch");
  return (
    <section className="space-y-3">
      {accent === "compare" && (
        <span className="inline-block text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full bg-bay-100 text-bay-700">
          Comparison
        </span>
      )}
      {trendBullets.length > 0 && (
        <section className="surface p-5 bg-gradient-to-br from-white to-bay-50">
          <header className="flex items-baseline justify-between flex-wrap gap-2">
            <h3 className="font-display text-lg text-slate2-900">Week-over-week shift</h3>
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
        <TimeOfDayChart data={trend.timeOfDay} areaLabel={trend.area.label} />
      )}

      <section className="surface p-5">
        <header className="flex items-baseline justify-between flex-wrap gap-2">
          <h3 className="font-display text-lg text-slate2-900">Recent dispatches in {trend.area.label}</h3>
          <div className="flex items-center gap-3 text-xs text-slate2-500">
            <span>{trend.totalIncidents.toLocaleString()} in last 30 days</span>
            {dispatchBullets.length > 0 && (
              <button
                onClick={() => downloadDispatchCsv(trend, dispatchBullets)}
                className="text-bay-700 hover:underline"
                aria-label="Download dispatches as CSV"
              >
                Download CSV
              </button>
            )}
          </div>
        </header>

        {dispatchBullets.length === 0 ? (
          <p className="mt-3 text-sm text-slate2-500">
            No dispatches in the past 30 days for this neighborhood — that&apos;s normal for many areas in any given month.
          </p>
        ) : (
          <ol className="mt-3 space-y-1.5">
            {dispatchBullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate2-700">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${b.category ? CAT_DOT[b.category] : "bg-slate2-400"}`} />
                <span>{b.text}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-4 text-xs text-slate2-500">
          Source:{" "}
          <a href={trend.source.url} target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">
            {trend.source.label}
          </a>
        </p>
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
function downloadDispatchCsv(trend: TrendResp, dispatches: TrendBullet[]) {
  if (typeof window === "undefined") return;
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

function TimeOfDayChart({ data, areaLabel }: {
  data: NonNullable<TrendResp["timeOfDay"]>;
  areaLabel: string;
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
        <h3 className="font-display text-lg text-slate2-900">When reports happen</h3>
        <span className="text-xs text-slate2-500">{areaLabel} · 30-day window</span>
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
