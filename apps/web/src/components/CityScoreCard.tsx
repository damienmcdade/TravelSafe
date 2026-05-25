"use client";
import { useApi } from "@/lib/api-client";
import { formatRatePer100k, formatRatePer100kProse, formatDeltaPct } from "@/lib/format";
// Import the vintage label DIRECTLY from the package (not the apps/web
// server-only shim) so this client component can include it in the
// bundle without tripping Next's server/client boundary. The constant
// has zero runtime cost and exposes no secrets.
import { POPULATION_VINTAGE } from "@travelsafe/crime-data/population";

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
  grade: "A" | "B" | "C" | "D" | "E" | "N/A";
  headline: string;
  rows: ScoreRow[];
  source: { label: string; url: string; publishedYear: number };
  disclaimer: string;
  dataConfidence?: "high" | "medium" | "low";
  dataConfidenceNote?: string;
}

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

/// Citywide Safety Score — always city-scoped, ignores any selected
/// neighborhood. Replacement for embedding the full SafetyScorePage
/// inside /city, which dragged in neighborhood drill-down, FBI chips,
/// compare overlay, and area-aware TrendPanel. This component renders
/// ONLY the grade card + per-category bars vs FBI national. No
/// methodology disclaimer panel, no picker, no chips.
export function CityScoreCard({ citySlug, cityLabel }: { citySlug: string; cityLabel: string }) {
  const path = `/safezone/safety-score?city=${encodeURIComponent(citySlug)}`;
  const { data: score, loading, error } = useApi<ScoreResp>(path, [path]);

  if (loading && !score) return <ScoreSkeleton />;
  if (error && !loading) {
    return (
      <p className="surface p-4 text-sm text-dusk-700">
        Could not compute the citywide safety score for {cityLabel} right now. The police feed may be warming up — try again in a moment.
      </p>
    );
  }
  if (!score) return null;

  const tone = GRADE_TONE[score.grade];
  const max = Math.max(...score.rows.map((r) => Math.max(r.localPer100k, r.nationalPer100k))) * 1.15 || 1;

  return (
    <section className="space-y-3">
      <section className={`surface p-5 sm:p-6 ring-1 ${tone.ring} ${tone.bg}`}>
        <div className="flex items-center gap-4">
          <div className={`flex items-center justify-center w-20 h-20 rounded-2xl ring-2 ${tone.ring} bg-white text-4xl font-display ${tone.tone}`}>
            {score.grade}
          </div>
          <div>
            <p className={`text-xs uppercase tracking-wider font-medium ${tone.tone}`}>{tone.label}</p>
            <h2 className="mt-0.5 font-display text-xl text-slate2-900">{cityLabel} — citywide</h2>
            <p className="mt-1 text-sm text-slate2-700 max-w-2xl">{score.headline}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate2-500 tabular-nums items-center">
          <span>~{score.populationEstimate.toLocaleString()} residents (estimated, US Census {POPULATION_VINTAGE})</span>
          {score.windowDays > 0 && <span>·  window: ~{score.windowDays} days</span>}
          {score.asOf && <span>·  newest report: {new Date(score.asOf).toLocaleDateString()}</span>}
        </div>
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

      <ul className={`grid grid-cols-1 ${score.rows.length > 1 ? "md:grid-cols-2" : ""} gap-3`}>
        {score.rows.map((r) => {
          const above = r.deltaPct > 5;
          const below = r.deltaPct < -5;
          return (
            <li key={r.category}>
              <article className="surface p-5 h-full">
                <header className="flex items-baseline justify-between gap-2">
                  <h3 className="font-display text-base text-slate2-900">{CAT_LABEL[r.category]}</h3>
                  <span className={`text-xs font-medium ${above ? "text-coral-700" : below ? "text-sage-700" : "text-slate2-500"}`}>
                    {formatDeltaPct(r.deltaPct)} vs national
                  </span>
                </header>
                <svg viewBox="0 0 200 50" className="mt-3 w-full h-12" role="img" aria-label={`${CAT_LABEL[r.category]}: ${formatRatePer100kProse(r.localPer100k)} ${cityLabel} citywide, ${formatRatePer100kProse(r.nationalPer100k)} national`}>
                  <text x="0" y="9" style={{ fontSize: 6 }} fill="#475569">{cityLabel}</text>
                  <rect x="0" y="12" width="200" height="7" rx="2" fill="#e9eef3" />
                  <rect x="0" y="12" width={(r.localPer100k / max) * 200} height="7" rx="2" fill={above ? "#DC2626" : below ? "#7BA86E" : "#2563EB"} />
                  <text x="200" y="9" textAnchor="end" style={{ fontSize: 6 }} fill="#475569">{formatRatePer100k(r.localPer100k)}</text>
                  <text x="0" y="32" style={{ fontSize: 6 }} fill="#475569">National (FBI {score.source.publishedYear})</text>
                  <rect x="0" y="35" width="200" height="7" rx="2" fill="#e9eef3" />
                  <rect x="0" y="35" width={(r.nationalPer100k / max) * 200} height="7" rx="2" fill="#94a3b8" />
                  <text x="200" y="32" textAnchor="end" style={{ fontSize: 6 }} fill="#475569">{formatRatePer100k(r.nationalPer100k)}</text>
                </svg>
                <p className="mt-2 text-xs text-slate2-500 tabular-nums">
                  {r.count.toLocaleString()} reported in the cached window.
                </p>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
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
