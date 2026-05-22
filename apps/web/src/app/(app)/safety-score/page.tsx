"use client";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { useArea, type AreaSelection } from "@/lib/use-area";
import { CityBanner } from "@/components/CitySelector";
import { SafeZoneSubNav } from "@/components/SafeZoneSubNav";
import { SafeZoneAreaPicker } from "@/components/SafeZoneAreaPicker";

interface ScoreRow {
  category: "PERSONS" | "PROPERTY";
  count: number;
  localPer100k: number;
  nationalPer100k: number;
  deltaPct: number;
}
interface ScoreResp {
  city: { slug: string; label: string };
  area: { slug: string; label: string };
  populationEstimate: number;
  windowDays: number;
  asOf: string | null;
  grade: "A" | "B" | "C" | "D" | "E";
  headline: string;
  rows: ScoreRow[];
  source: { label: string; url: string; publishedYear: number };
  disclaimer: string;
}

// Five-step grade tone with a gentle green → sand → terracotta gradient.
// No alarming reds — the worst grade (E) lands at a muted terracotta that
// reads "noteworthy" rather than "emergency".
const GRADE_TONE: Record<ScoreResp["grade"], { bg: string; ring: string; tone: string; label: string }> = {
  A: { bg: "bg-sage-100",   ring: "ring-sage-300",   tone: "text-sage-700",    label: "Well below national" },
  B: { bg: "bg-sage-50",    ring: "ring-sage-200",   tone: "text-sage-700",    label: "Below national" },
  C: { bg: "bg-sand-50",    ring: "ring-sand-300",   tone: "text-slate2-700",  label: "Near national average" },
  D: { bg: "bg-amber2-50",  ring: "ring-amber2-300", tone: "text-amber2-700",  label: "Above national" },
  E: { bg: "bg-amber2-100", ring: "ring-amber2-400", tone: "text-coral-700",   label: "Well above national" },
};

const CAT_LABEL: Record<ScoreRow["category"], string> = {
  PERSONS:  "Violent (persons)",
  PROPERTY: "Property",
};

export default function SafetyScorePage() {
  const { city } = useCity();
  // null === citywide view (the default). Reads from the GLOBAL area store
  // keyed by city slug — picking a neighborhood here also propagates to
  // Awareness, CommunitySafe, Trend Feed, Personal Safety, etc.
  const { area, setArea } = useArea(city.slug);

  // Compare area is local-only — comparison is a transient action, not a
  // persistent preference, so it doesn't write to the global useArea
  // store (would cause other tabs to flip selections unexpectedly).
  const [compareArea, setCompareArea] = useState<AreaSelection | null>(null);
  const [showComparePicker, setShowComparePicker] = useState(false);

  const path = area
    ? `/safezone/safety-score?area=${encodeURIComponent(area.slug)}&label=${encodeURIComponent(area.label)}`
    : `/safezone/safety-score?city=${encodeURIComponent(city.slug)}`;
  const comparePath = compareArea
    ? `/safezone/safety-score?area=${encodeURIComponent(compareArea.slug)}&label=${encodeURIComponent(compareArea.label)}`
    : null;
  const { data: score, loading, error } = useApi<ScoreResp>(path, [path]);
  const { data: compareScore, loading: compareLoading } = useApi<ScoreResp>(comparePath, [comparePath]);

  const compareMode = compareArea !== null;

  return (
    <main className="space-y-6">
      <SafeZoneSubNav />
      <header className="page-hero">
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">SafeZone · Safety Score · {city.label}</p>
        <h1 className="mt-1 font-display text-3xl sm:text-4xl text-slate2-900">
          How {city.label} <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x">compares to the FBI national average</span>
        </h1>
        <p className="mt-2 text-slate2-700 max-w-2xl">
          Defaults to a citywide score against the FBI Crime in the Nation 2024 national rate. Drill into a specific {city.label} neighborhood below if you want a per-area comparison, or use Compare to put two neighborhoods side-by-side.
        </p>
      </header>
      <CityBanner />

      {area && (
        <div className="flex items-center justify-between flex-wrap gap-2 surface-muted px-4 py-3">
          <p className="text-sm text-slate2-700">
            Showing {area.label} · drill-down view.
          </p>
          <button
            onClick={() => { setArea(null); setCompareArea(null); setShowComparePicker(false); }}
            className="text-xs text-bay-700 hover:underline"
          >
            ← Back to {city.label} citywide
          </button>
        </div>
      )}

      <SafeZoneAreaPicker
        storageKey="safety-score.area"
        onCommit={setArea}
        selectedSlug={area?.slug ?? null}
        title={`Drill into a ${city.label} neighborhood (optional)`}
        subtitle={`Citywide is the default. Pick a neighborhood to compare just that area against the FBI national rate.`}
        commitLabel="Show this neighborhood"
        autoCommit={false}
      />

      {loading && !score && <ScoreSkeleton />}
      {error && !loading && (
        <p className="surface p-4 text-sm text-dusk-700">
          Could not compute the score for {area?.label ?? `${city.label} citywide`}. The police feed may be warming up — try again in a moment.
        </p>
      )}

      {score && (
        <>
          {/* Side-by-side when comparing, single column otherwise. items-start
              keeps the two columns from stretching to match each other's
              empty space when one finishes loading first. */}
          <div className={compareMode ? "grid grid-cols-1 lg:grid-cols-2 gap-4 items-start" : ""}>
            <ScoreReport score={score} />
            {compareMode && (
              compareScore
                ? <ScoreReport score={compareScore} accent="compare" />
                : compareLoading
                  ? <ScoreSkeleton />
                  : (
                    <p className="surface p-4 text-sm text-dusk-700">
                      Couldn&apos;t compute the comparison score for {compareArea?.label}.
                    </p>
                  )
            )}
          </div>

          {/* Compare controls — surfaced ONLY when there's a primary score
              to compare against. The picker is collapsed by default so the
              page doesn't grow vertically until the user opts in. */}
          <CompareControls
            cityLabel={city.label}
            compareArea={compareArea}
            primarySlug={area?.slug ?? null}
            showPicker={showComparePicker}
            onTogglePicker={() => setShowComparePicker((v) => !v)}
            onPickCompare={(a) => { setCompareArea(a); setShowComparePicker(false); }}
            onClearCompare={() => setCompareArea(null)}
          />

          <p className="surface-muted p-3 text-xs text-slate2-700 leading-snug">
            {score.disclaimer} Verify the national rate at{" "}
            <a href={score.source.url} target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">
              {score.source.label}
            </a>.
          </p>
        </>
      )}
    </main>
  );
}

/// Stateless score panel. Renders the hero grade card plus the per-category
/// comparison rows. The `accent` prop lets the compare-mode variant use a
/// slightly different visual marker so users can tell at a glance which
/// panel is the primary view and which is the compare overlay.
function ScoreReport({ score, accent }: { score: ScoreResp; accent?: "compare" }) {
  const tone = GRADE_TONE[score.grade];
  return (
    <section className="space-y-3">
      {accent === "compare" && (
        <span className="inline-block text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full bg-bay-100 text-bay-700">
          Comparison
        </span>
      )}
      <section className={`surface p-5 sm:p-6 ring-1 ${tone.ring} ${tone.bg}`}>
        <div className="flex items-center gap-4">
          <div className={`flex items-center justify-center w-20 h-20 rounded-2xl ring-2 ${tone.ring} bg-white text-4xl font-display ${tone.tone}`}>
            {score.grade}
          </div>
          <div>
            <p className={`text-xs uppercase tracking-wider font-medium ${tone.tone}`}>{tone.label}</p>
            <h2 className="mt-0.5 font-display text-xl text-slate2-900">{score.area.label}, {score.city.label}</h2>
            <p className="mt-1 text-sm text-slate2-700 max-w-2xl">{score.headline}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate2-500 tabular-nums">
          <span>~{score.populationEstimate.toLocaleString()} residents (estimated, US Census Vintage 2023)</span>
          {score.windowDays > 0 && <span>·  window: ~{score.windowDays} days</span>}
          {score.asOf && <span>·  newest report: {new Date(score.asOf).toLocaleDateString()}</span>}
        </div>
      </section>

      <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {score.rows.map((r) => {
          const above = r.deltaPct > 5;
          const below = r.deltaPct < -5;
          const max = Math.max(r.localPer100k, r.nationalPer100k) * 1.15 || 1;
          return (
            <li key={r.category}>
              <article className="surface p-5 h-full">
                <header className="flex items-baseline justify-between gap-2">
                  <h3 className="font-display text-base text-slate2-900">{CAT_LABEL[r.category]}</h3>
                  <span className={`text-xs font-medium ${above ? "text-coral-700" : below ? "text-sage-700" : "text-slate2-500"}`}>
                    {r.deltaPct > 0 ? "+" : ""}{r.deltaPct}% vs national
                  </span>
                </header>
                <svg viewBox="0 0 200 56" className="mt-3 w-full h-14" role="img" aria-label={`${CAT_LABEL[r.category]}: ${r.localPer100k} per 100k locally, ${r.nationalPer100k} per 100k national`}>
                  <text x="0" y="11" style={{ fontSize: 6 }} fill="#475569">{score.area.label}</text>
                  <rect x="0" y="14" width="200" height="8" rx="2" fill="#e9eef3" />
                  <rect x="0" y="14" width={(r.localPer100k / max) * 200} height="8" rx="2" fill={above ? "#C47C62" : below ? "#7BA86E" : "#5C8AA7"} />
                  <text x="200" y="11" textAnchor="end" style={{ fontSize: 6 }} fill="#475569">{r.localPer100k.toLocaleString()} / 100k</text>
                  <text x="0" y="38" style={{ fontSize: 6 }} fill="#475569">National (FBI {score.source.publishedYear})</text>
                  <rect x="0" y="41" width="200" height="8" rx="2" fill="#e9eef3" />
                  <rect x="0" y="41" width={(r.nationalPer100k / max) * 200} height="8" rx="2" fill="#94a3b8" />
                  <text x="200" y="38" textAnchor="end" style={{ fontSize: 6 }} fill="#475569">{r.nationalPer100k.toLocaleString()} / 100k</text>
                </svg>
                <p className="mt-3 text-xs text-slate2-500 tabular-nums">{r.count.toLocaleString()} reported in the cached window.</p>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/// Compare controls — the "Compare with another neighborhood" affordance.
/// Collapsed by default so the page doesn't grow vertically until the user
/// opts in. Picking a comparison area populates the second column above;
/// clearing it returns to the single-column view.
function CompareControls({
  cityLabel, compareArea, primarySlug, showPicker, onTogglePicker, onPickCompare, onClearCompare,
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
        {showPicker ? "− Hide compare picker" : "+ Compare with another neighborhood"}
      </button>
      {showPicker && (
        <SafeZoneAreaPicker
          storageKey="safety-score.compare"
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

function ScoreSkeleton() {
  return (
    <section className="surface p-5 space-y-3">
      <div className="flex items-center gap-4">
        <div className="skel w-20 h-20 rounded-2xl" />
        <div className="flex-1 space-y-2">
          <div className="skel h-3 w-1/3" />
          <div className="skel h-5 w-1/2" />
          <div className="skel h-3 w-3/4" />
        </div>
      </div>
    </section>
  );
}
