"use client";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { useArea, type AreaSelection } from "@/lib/use-area";
import { useDocumentTitle } from "@/lib/use-document-title";
import { SafeZoneAreaPicker } from "@/components/SafeZoneAreaPicker";
import { SaveAreaStar } from "@/components/SavedAreasRail";
import { TrendPanel } from "@/components/TrendPanel";

interface ScoreRow {
  category: "PERSONS" | "PROPERTY";
  count: number;
  localPer100k: number;
  cityPer100k: number;
  cityDeltaPct: number;
  nationalPer100k: number;
  deltaPct: number;
}
interface ScoreResp {
  city: { slug: string; label: string };
  area: { slug: string; label: string };
  populationEstimate: number;
  windowDays: number;
  asOf: string | null;
  // "N/A" is returned when the underlying adapter has no usable recent
  // data for this area — counts are zero AND confidence is low. The UI
  // renders a neutral "Data unavailable" card rather than a misleading
  // letter grade.
  grade: "A" | "B" | "C" | "D" | "E" | "N/A";
  headline: string;
  rows: ScoreRow[];
  source: { label: string; url: string; publishedYear: number };
  disclaimer: string;
  dataConfidence?: "high" | "medium" | "low";
  dataConfidenceNote?: string;
  dataSourceType?: "nibrs" | "cfs";
  cfsScale?: number;
}

// Five-step grade tone with a gentle green → sand → terracotta gradient.
// No alarming reds — the worst grade (E) lands at a muted terracotta that
// reads "noteworthy" rather than "emergency".
// Labels reflect "reports relative to the national rate" rather than
// "this neighborhood is safer/more dangerous" — the latter framing
// invites Fair-Housing-adjacent interpretation when reports cluster in
// historically disadvantaged areas. We compare report VOLUME against
// the FBI national average; the label phrasing makes that scope clear.
const GRADE_TONE: Record<ScoreResp["grade"], { bg: string; ring: string; tone: string; label: string }> = {
  A:     { bg: "bg-sage-100",   ring: "ring-sage-300",   tone: "text-sage-700",   label: "Lower than national rate" },
  B:     { bg: "bg-sage-50",    ring: "ring-sage-200",   tone: "text-sage-700",   label: "Below national rate" },
  C:     { bg: "bg-sand-50",    ring: "ring-sand-300",   tone: "text-slate2-700", label: "Near national rate" },
  D:     { bg: "bg-amber2-50",  ring: "ring-amber2-300", tone: "text-amber2-700", label: "Above national rate" },
  E:     { bg: "bg-amber2-100", ring: "ring-amber2-400", tone: "text-coral-700",  label: "Higher than national rate" },
  "N/A": { bg: "bg-slate2-50",  ring: "ring-slate2-200", tone: "text-slate2-500", label: "Data unavailable" },
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
  useDocumentTitle(`Safety Score · ${area?.label ?? city.label}`);

  // Category filter — client-side only. Hides the row for the deselected
  // category. The hero grade reflects the overall (both categories) so
  // there's a small caption explaining that the chip narrows the
  // visible comparison without changing the score itself.
  const [categoryFilter, setCategoryFilter] = useState<"ALL" | "PERSONS" | "PROPERTY">("ALL");

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
      <header className="page-hero">
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">SafeZone · Safety Score · {city.label}</p>
        <h1 className="mt-1 font-display text-3xl sm:text-4xl text-slate2-900">
          How {city.label} <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x">compares to the FBI national average</span>
        </h1>
        <p className="mt-2 text-slate2-700 max-w-2xl">
          Defaults to a citywide score against the FBI Crime in the Nation 2024 national rate. Drill into a specific {city.label} neighborhood below if you want a per-area comparison, or use Compare to put two neighborhoods side-by-side.
        </p>
      </header>

      {area && (
        <div className="flex items-center justify-between flex-wrap gap-2 surface-muted px-4 py-3">
          <p className="text-sm text-slate2-700">
            Showing {area.label} · drill-down view.
          </p>
          <div className="flex items-center gap-2">
            <SaveAreaStar area={area} />
            <button
              onClick={() => { setArea(null); setCompareArea(null); setShowComparePicker(false); }}
              className="text-xs text-bay-700 hover:underline"
            >
              ← Back to {city.label} citywide
            </button>
          </div>
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
          <CategoryFilterChips value={categoryFilter} onChange={setCategoryFilter} />

          <div className={compareMode ? "grid grid-cols-1 lg:grid-cols-2 gap-4 items-start" : ""}>
            <ScoreReport score={score} categoryFilter={categoryFilter} />
            {compareMode && (
              compareScore
                ? <ScoreReport score={compareScore} accent="compare" categoryFilter={categoryFilter} />
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

          <p className="surface-muted p-3 text-xs text-slate2-700 leading-snug" role="note">
            <strong className="text-slate2-900">Methodology:</strong> {score.disclaimer} Verify the national rate at{" "}
            <a href={score.source.url} target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">
              {score.source.label}
            </a>.
          </p>
        </>
      )}

      {/* Trend section — same component the /trends URL alias renders.
          Lives below the Score so users land on the index first, then
          scroll into the timeline detail without switching tabs.
          Section id="trends" so /trends#trends and the in-page anchor
          both work for deep-linking. headingLevel=3 because the
          ScoreReport above already uses h2 — TrendPanel slots in as a
          subsection rather than a peer. */}
      <TrendPanel headingLevel={3} />
    </main>
  );
}

/// Stateless score panel. Renders the hero grade card plus the per-category
/// comparison rows. The `accent` prop lets the compare-mode variant use a
/// slightly different visual marker so users can tell at a glance which
/// panel is the primary view and which is the compare overlay.
function ScoreReport({ score, accent, categoryFilter }: { score: ScoreResp; accent?: "compare"; categoryFilter?: "ALL" | "PERSONS" | "PROPERTY" }) {
  const tone = GRADE_TONE[score.grade];
  const filteredRows = categoryFilter && categoryFilter !== "ALL"
    ? score.rows.filter((r) => r.category === categoryFilter)
    : score.rows;
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
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate2-500 tabular-nums items-center">
          <span>~{score.populationEstimate.toLocaleString()} residents (estimated, US Census Vintage 2023)</span>
          {score.windowDays > 0 && <span>·  window: ~{score.windowDays} days</span>}
          {score.asOf && <span>·  newest report: {new Date(score.asOf).toLocaleDateString()}</span>}
          {/* CFS calibration badge — surfaces the per-city scaling
              applied to Cleveland / NOLA / LV. NIBRS cities get no
              badge (default state). */}
          {score.dataSourceType === "cfs" && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bay-50 border border-bay-200 text-bay-700 text-[10px] uppercase tracking-wider font-medium"
              title={`This city publishes calls-for-service rather than closed NIBRS reports. Rates are calibrated ×${score.cfsScale ?? 1.0} to approximate NIBRS-equivalent volumes (CFS is structurally 2–3× inflated because each crime spawns multiple dispatches and many dispatches are unfounded).`}
            >
              CFS-calibrated × {(score.cfsScale ?? 1).toFixed(2)}
            </span>
          )}
        </div>
        {/* Data-confidence caveat — shown when the underlying data is
            short of what's needed for a stable grade. Prevents users
            from reading a transient upstream slowdown as a definitive
            judgment. Tone bands match the existing semantic palette. */}
        {score.dataConfidence && score.dataConfidence !== "high" && score.dataConfidenceNote && (
          <p
            role="status"
            className={`mt-3 text-xs px-3 py-2 rounded-lg border leading-snug ${
              score.dataConfidence === "low"
                ? "bg-amber2-50 border-amber2-300/60 text-amber2-700"
                : "bg-sand-50 border-sand-300 text-slate2-700"
            }`}
          >
            <strong className="text-slate2-900">
              {score.dataConfidence === "low" ? "Limited data — grade is provisional." : "Smaller-than-usual data window."}
            </strong>{" "}
            {score.dataConfidenceNote}
          </p>
        )}
      </section>

      <ul className={`grid grid-cols-1 ${filteredRows.length > 1 ? "md:grid-cols-2" : ""} gap-3`}>
        {filteredRows.map((r) => {
          // Primary comparison is now vs CITY rate. Citywide rows have
          // cityDeltaPct=0 by definition (the area IS the city); fall
          // back to deltaPct (vs national) in that case so the chip
          // still says something meaningful.
          const isCitywide = score.area.slug === score.city.slug;
          const primaryDelta = isCitywide ? r.deltaPct : r.cityDeltaPct;
          const primaryAnchor = isCitywide ? "national" : `${score.city.label} citywide`;
          const above = primaryDelta > 5;
          const below = primaryDelta < -5;
          const max = Math.max(r.localPer100k, isCitywide ? r.nationalPer100k : r.cityPer100k, r.nationalPer100k) * 1.15 || 1;
          return (
            <li key={r.category}>
              <article className="surface p-5 h-full">
                <header className="flex items-baseline justify-between gap-2">
                  <h3 className="font-display text-base text-slate2-900">{CAT_LABEL[r.category]}</h3>
                  <span className={`text-xs font-medium ${above ? "text-coral-700" : below ? "text-sage-700" : "text-slate2-500"}`}>
                    {primaryDelta > 0 ? "+" : ""}{primaryDelta}% vs {primaryAnchor}
                  </span>
                </header>
                <svg viewBox="0 0 200 70" className="mt-3 w-full h-16" role="img" aria-label={`${CAT_LABEL[r.category]}: ${r.localPer100k} per 100k locally, ${r.cityPer100k} per 100k ${score.city.label} citywide, ${r.nationalPer100k} per 100k national`}>
                  {/* This area */}
                  <text x="0" y="9" style={{ fontSize: 6 }} fill="#475569">{score.area.label}</text>
                  <rect x="0" y="12" width="200" height="7" rx="2" fill="#e9eef3" />
                  <rect x="0" y="12" width={(r.localPer100k / max) * 200} height="7" rx="2" fill={above ? "#DC2626" : below ? "#7BA86E" : "#2563EB"} />
                  <text x="200" y="9" textAnchor="end" style={{ fontSize: 6 }} fill="#475569">{r.localPer100k.toLocaleString()} / 100k</text>
                  {/* City baseline — only shown for per-area rows */}
                  {!isCitywide && (
                    <>
                      <text x="0" y="32" style={{ fontSize: 6 }} fill="#475569">{score.city.label} citywide</text>
                      <rect x="0" y="35" width="200" height="7" rx="2" fill="#e9eef3" />
                      <rect x="0" y="35" width={(r.cityPer100k / max) * 200} height="7" rx="2" fill="#0E4F73" />
                      <text x="200" y="32" textAnchor="end" style={{ fontSize: 6 }} fill="#475569">{r.cityPer100k.toLocaleString()} / 100k</text>
                    </>
                  )}
                  {/* National reference */}
                  <text x="0" y={isCitywide ? 32 : 55} style={{ fontSize: 6 }} fill="#475569">National (FBI {score.source.publishedYear})</text>
                  <rect x="0" y={isCitywide ? 35 : 58} width="200" height="7" rx="2" fill="#e9eef3" />
                  <rect x="0" y={isCitywide ? 35 : 58} width={(r.nationalPer100k / max) * 200} height="7" rx="2" fill="#94a3b8" />
                  <text x="200" y={isCitywide ? 32 : 55} textAnchor="end" style={{ fontSize: 6 }} fill="#475569">{r.nationalPer100k.toLocaleString()} / 100k</text>
                </svg>
                <p className="mt-3 text-xs text-slate2-500 tabular-nums">
                  {r.count.toLocaleString()} reported in the cached window
                  {!isCitywide && <span> · {r.deltaPct > 0 ? "+" : ""}{r.deltaPct}% vs national</span>}.
                </p>
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

function CategoryFilterChips({
  value, onChange,
}: { value: "ALL" | "PERSONS" | "PROPERTY"; onChange: (v: "ALL" | "PERSONS" | "PROPERTY") => void }) {
  const chips: Array<{ id: "ALL" | "PERSONS" | "PROPERTY"; label: string; sublabel: string }> = [
    { id: "ALL",      label: "Both categories", sublabel: "Violent + property" },
    { id: "PERSONS",  label: "Violent only",    sublabel: "NIBRS persons" },
    { id: "PROPERTY", label: "Property only",   sublabel: "NIBRS property" },
  ];
  return (
    <div className="surface-muted px-4 py-3 flex items-center justify-between flex-wrap gap-2">
      <p className="text-xs text-slate2-700">
        <strong className="text-slate2-900">Show:</strong>{" "}
        {value === "ALL"
          ? "Both FBI categories side by side."
          : value === "PERSONS"
            ? "Violent (NIBRS persons) only. Grade still reflects the overall comparison."
            : "Property only. Grade still reflects the overall comparison."}
      </p>
      <div className="flex gap-1 text-xs">
        {chips.map((c) => (
          <button
            key={c.id}
            onClick={() => onChange(c.id)}
            title={c.sublabel}
            aria-pressed={value === c.id}
            className={`px-2.5 py-1 rounded-md transition-colors ${
              value === c.id ? "bg-bay-500 text-white" : "text-slate2-700 hover:bg-bay-100"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
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
