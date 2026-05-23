"use client";
import type { BlockScore, BlockScoreBand } from "./types";

export interface BlockScoreWidgetProps {
  /// Normalized 0–100 index. Pass null while loading.
  score: BlockScore | null;
  /// Loading shim; renders a skeleton ring when true.
  loading?: boolean;
  /// True when the score could not be computed (e.g., unknown area, fetch
  /// error). Renders an explicit "data unavailable" panel instead of the
  /// skeleton or a misleading default ring. Prevents the all-100 incident
  /// from recurring: a failed score MUST NOT render as 100.
  unavailable?: boolean;
  /// Subtitle. Typically the area or city label.
  contextLabel: string;
}

// Muted band colors aligned with the rest of the app's premium palette.
// Labels are written in plain English — readers should be able to tell
// at a glance what the number means without learning a new vocabulary.
const BAND_STYLE: Record<BlockScoreBand, { stroke: string; fill: string; tone: string; chip: string; label: string }> = {
  safe:     { stroke: "#7BA86E", fill: "#EAF4E6", tone: "text-sage-700",    chip: "bg-sage-100 ring-sage-200",    label: "Fewer reports than national average" },
  moderate: { stroke: "#F59E0B", fill: "#FAF1DD", tone: "text-amber2-700",  chip: "bg-amber2-50 ring-amber2-300", label: "About the national average" },
  elevated: { stroke: "#DC2626", fill: "#F4E1D9", tone: "text-coral-700",   chip: "bg-coral-100 ring-coral-200",  label: "More reports than national average" },
};

// SVG ring geometry — single source of truth used by both the full and
// skeleton states so the layout doesn't jump when data arrives.
const SIZE = 160;
const STROKE = 14;
const RADIUS = SIZE / 2 - STROKE;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/// Stateless presentation widget. Renders a circular progress ring with the
/// normalized BlockScore index in the center, a band chip, and a citation
/// link to the benchmark source. No data fetching, no global access.
export function BlockScoreWidget({ score, loading, unavailable, contextLabel }: BlockScoreWidgetProps) {
  // Explicit unavailable state takes precedence over the skeleton —
  // showing a skeleton forever when the data load failed is worse than
  // saying "we couldn't compute this". This is the second invariant
  // that prevents the all-100 incident from recurring: a failed score
  // MUST render visibly-unavailable instead of falling through to a
  // default ring.
  if (unavailable && !loading) {
    return (
      <section className="surface p-6 bg-gradient-to-br from-white to-sand-50 min-h-[200px] flex flex-col items-center justify-center text-center">
        <p className="text-xs uppercase tracking-wider text-slate2-500">Safety Index unavailable</p>
        <h3 className="mt-1 font-display text-base text-slate2-900">{contextLabel}</h3>
        <p className="mt-2 text-sm text-slate2-700 max-w-md">
          The Safety Index for this area could not be computed — most likely the
          police adapter is warming up or this area slug isn&apos;t in the city&apos;s
          discovered neighborhood list. Try a different neighborhood, or refresh
          in a moment.
        </p>
      </section>
    );
  }

  if (loading || !score) {
    return (
      <section className="surface p-6 bg-gradient-to-br from-white to-sand-50">
        <div className="flex items-center gap-5">
          <SkeletonRing />
          <div className="flex-1 space-y-2">
            <div className="skel h-3 w-1/3" />
            <div className="skel h-5 w-2/3" />
            <div className="skel h-3 w-3/4" />
          </div>
        </div>
      </section>
    );
  }

  const style = BAND_STYLE[score.band];
  // Floor the dash length so a score of literal 0 (degenerate API
  // response) still renders a faint arc rather than vanishing entirely.
  // 1.5px of stroke is enough to be visible on every viewport.
  const dash = Math.max(1.5, (score.score / 100) * CIRCUMFERENCE);

  return (
    <section className="surface p-6 bg-gradient-to-br from-white to-sand-50">
      <div className="flex items-center gap-5 flex-wrap">
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`BlockScore ${score.score} out of 100, ${style.label}`}>
            {/* Track */}
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="#e9eef3"
              strokeWidth={STROKE}
            />
            {/* Filled arc */}
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={style.stroke}
              strokeWidth={STROKE}
              strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
              strokeDashoffset={CIRCUMFERENCE / 4}
              strokeLinecap="round"
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              style={{ transition: "stroke-dasharray 700ms ease-out" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center select-none">
            <span className="text-[10px] uppercase tracking-wider text-slate2-500">Safety Index</span>
            <span className="font-display text-4xl text-slate2-900 leading-none">{score.score}</span>
            <span className="text-[10px] text-slate2-500 mt-0.5">out of 100</span>
          </div>
        </div>

        <div className="flex-1 min-w-[14rem]">
          <span className={`inline-block text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full ring-1 ${style.chip} ${style.tone}`}>
            {style.label}
          </span>
          <h3 className="mt-2 font-display text-lg text-slate2-900">{contextLabel}</h3>
          <p className="mt-1 text-sm text-slate2-700 leading-snug">{score.headline}</p>
          <p className="mt-2 text-xs text-slate2-500 leading-snug">
            Higher means fewer police reports per resident than the FBI national average.
            100 = no recent reports; 50 = roughly matches the national rate;
            below 50 = more reports per resident than the national average.
          </p>
          <a
            href={score.benchmark.url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-xs text-bay-700 hover:underline"
          >
            Compared against: {score.benchmark.label} ({score.benchmark.year}) →
          </a>
        </div>
      </div>

      <BandLegend currentBand={score.band} />

      <HowItsCalculated benchmark={score.benchmark} />

      <p className="mt-3 text-[11px] text-slate2-500 leading-snug">
        Based on publicly published police reports over the cached window. Reflects historical reporting only — not a prediction
        of future risk, and not a substitute for professional safety advice. Should not be used as the sole basis for housing,
        lending, insurance, or hiring decisions.
      </p>
    </section>
  );
}

/// Plain-English methodology disclosure. Collapsed by default so it
/// doesn't crowd the score, expanded on click. Walks the user through
/// the four-step calculation in everyday language and names the two
/// public datasets that drive it (the city's police feed and the FBI
/// national rate) so the math is auditable, not magical.
function HowItsCalculated({ benchmark }: { benchmark: BlockScore["benchmark"] }) {
  return (
    <details className="mt-4 group">
      <summary className="cursor-pointer list-none flex items-center gap-1.5 text-xs font-medium text-bay-700 hover:underline select-none">
        <span className="inline-block w-3 transition-transform group-open:rotate-90">›</span>
        How is this score calculated?
      </summary>
      <div className="mt-3 surface-muted p-4 text-xs text-slate2-700 leading-relaxed space-y-2.5">
        <p>
          We translate two public datasets into one easy-to-read number. No private
          information, no predictions — just published report counts plus arithmetic.
        </p>
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>
            <strong className="text-slate2-900">Count the reports.</strong>{" "}
            We pull every recently published police report in this neighborhood from
            the city&apos;s official open-data feed, split into violent (persons) and
            property crime — the two categories the FBI publishes national rates for.
          </li>
          <li>
            <strong className="text-slate2-900">Compare to the typical neighborhood.</strong>{" "}
            We total every tracked neighborhood in this city and figure out the average
            share. If a neighborhood reports twice the average share of city reports,
            it earns twice the rate; half the share earns half. This is what lets the
            score tell distinct neighborhoods apart honestly.
          </li>
          <li>
            <strong className="text-slate2-900">Express it as a rate per 100,000 residents.</strong>{" "}
            The same denominator the FBI uses for its city-vs-national comparisons,
            scaled by US Census Vintage 2023 city population.
          </li>
          <li>
            <strong className="text-slate2-900">Compare to the national average.</strong>{" "}
            We average the gap across both categories and map it onto a 0&ndash;100
            scale. <strong>100</strong> means no recent reports; <strong>50</strong>{" "}
            roughly matches the national rate; below 50 means above national. Higher
            is always safer in the data, lower is always more activity.
          </li>
        </ol>
        <p className="text-[11px] text-slate2-500 pt-1">
          Benchmark source:{" "}
          <a href={benchmark.url} target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">
            {benchmark.label} ({benchmark.year})
          </a>
        </p>
      </div>
    </details>
  );
}

function BandLegend({ currentBand }: { currentBand: BlockScoreBand }) {
  const rows: Array<{ band: BlockScoreBand; range: string; copy: string }> = [
    { band: "safe",     range: "80–100", copy: "Fewer reports than national rate" },
    { band: "moderate", range: "50–79",  copy: "Roughly matches national rate" },
    { band: "elevated", range: "0–49",   copy: "More reports than national rate" },
  ];
  return (
    <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
      {rows.map(({ band, range, copy }) => {
        const s = BAND_STYLE[band];
        const active = band === currentBand;
        return (
          <div
            key={band}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 ring-1 ${active ? s.chip : "ring-sand-200 bg-white"}`}
          >
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: s.stroke }} />
            <span className={`tabular-nums ${active ? s.tone : "text-slate2-500"}`}>{range}</span>
            <span className={`${active ? "text-slate2-900" : "text-slate2-500"}`}>{copy}</span>
          </div>
        );
      })}
    </div>
  );
}

function SkeletonRing() {
  return (
    <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="#e9eef3" strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="#cbd5e1"
          strokeWidth={STROKE}
          strokeDasharray={`${CIRCUMFERENCE / 3} ${CIRCUMFERENCE - CIRCUMFERENCE / 3}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          className="animate-pulse"
        />
      </svg>
    </div>
  );
}
