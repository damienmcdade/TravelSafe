"use client";
import { useApi } from "@/lib/api-client";

type Severity = "low" | "moderate" | "elevated";
type Trend = "stable" | "rising" | "falling";

interface SummaryResp {
  summary: string | null;
  severity: Severity;
  trend: Trend;
  changePct: number;
  windowDays: number;
  recentCount: number;
  priorCount: number;
}

// Severity badge tones — matched to BlockScoreWidget's bands so the
// same severity reads the same color anywhere it appears on a given
// page. v23 audit caught the prior elevated=amber here vs.
// elevated=coral on BlockScoreWidget, which made the two cards on
// the same Neighborhood Awareness page disagree visually about the
// same area's severity.
const SEVERITY: Record<Severity, { label: string; chip: string }> = {
  low:      { label: "Low",      chip: "bg-sage-100 text-sage-700 ring-sage-200" },
  moderate: { label: "Moderate", chip: "bg-sand-100 text-slate2-700 ring-sand-300" },
  elevated: { label: "Elevated", chip: "bg-coral-100 text-coral-700 ring-coral-200" },
};

// Trend arrow as inline SVG so it renders consistently in any
// browser without relying on icon font availability.
function TrendArrow({ trend, changePct }: { trend: Trend; changePct: number }) {
  const cls = trend === "rising"
    ? "text-amber2-700"
    : trend === "falling"
      ? "text-sage-700"
      : "text-slate2-500";
  const arrow = trend === "rising" ? "↑" : trend === "falling" ? "↓" : "→";
  const pct = `${changePct >= 0 ? "+" : ""}${changePct}%`;
  return (
    <span className={`inline-flex items-center gap-1 text-xs tabular-nums ${cls}`}>
      <span aria-hidden>{arrow}</span>
      <span>{pct} vs prior</span>
    </span>
  );
}

/// AI-summarized recent-activity card. Pulls the same severity/
/// trend signals the underlying service computes, plus an LLM
/// paragraph when the AI is configured. Renders something useful
/// even when the LLM is offline.
export function IncidentSummaryCard({
  areaSlug,
  citySlug,
  contextLabel,
  windowDays = 30,
}: {
  /// Pass an areaSlug for a per-neighborhood summary, OR a citySlug
  /// for a citywide one. Mutually exclusive.
  areaSlug?: string;
  citySlug?: string;
  /// Display label shown in the header ("San Diego (citywide)" or
  /// "Pacific Beach").
  contextLabel: string;
  windowDays?: number;
}) {
  const qs = areaSlug
    ? `area=${encodeURIComponent(areaSlug)}`
    : citySlug
      ? `city=${encodeURIComponent(citySlug)}`
      : null;
  const path = qs ? `/ai/incident-summary?${qs}&windowDays=${windowDays}` : null;
  const { data, loading, error } = useApi<SummaryResp>(path, [path]);

  if (loading && !data) {
    return (
      <section className="surface p-5 space-y-3">
        <div className="skel h-3 w-1/2" />
        <div className="skel h-3 w-3/4" />
        <div className="skel h-3 w-2/3" />
      </section>
    );
  }
  if (error && !data) {
    return (
      <section className="surface p-5 text-sm text-slate2-500">
        Couldn&apos;t generate a recent-activity summary right now.
      </section>
    );
  }
  if (!data) return null;

  const sev = SEVERITY[data.severity];
  return (
    <section className="surface p-5 space-y-3">
      <header className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate2-500">AI Summary</p>
          <h3 className="mt-0.5 font-display text-lg text-slate2-900">{contextLabel}</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full ring-1 ${sev.chip}`}>
            {sev.label}
          </span>
          <TrendArrow trend={data.trend} changePct={data.changePct} />
        </div>
      </header>

      {data.summary ? (
        <p className="text-sm text-slate2-700 leading-snug">{data.summary}</p>
      ) : (
        // Fallback when the LLM is offline / unconfigured. Still
        // useful because the deterministic counts + trend are
        // computed without the model.
        <p className="text-sm text-slate2-700 leading-snug">
          {data.recentCount.toLocaleString()} incidents reported in {contextLabel.toLowerCase()} over the last {data.windowDays} days
          {data.priorCount > 0 ? ` (${data.priorCount.toLocaleString()} in the prior ${data.windowDays}-day window).` : "."}
        </p>
      )}

      <p className="text-[11px] text-slate2-500 leading-snug">
        Severity bucket and trend are computed from incident counts; the summary text is AI-generated when the model is available. Not legal or medical advice.
      </p>
    </section>
  );
}
