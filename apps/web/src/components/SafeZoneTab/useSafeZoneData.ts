"use client";
import { useMemo } from "react";
import { useApi } from "@/lib/api-client";
import type {
  BaselinePoint,
  BlockScore,
  BlockScoreBand,
  SafeZoneDataState,
  SafeZoneSelection,
  ThreatItem,
} from "./types";

interface SafetyScoreApi {
  city: { slug: string; label: string };
  area: { slug: string; label: string };
  windowDays: number;
  asOf: string | null;
  rows: Array<{
    category: "PERSONS" | "PROPERTY";
    count: number;
    localPer100k: number;
    nationalPer100k: number;
    deltaPct: number;
  }>;
  source: { label: string; url: string; publishedYear: number };
}

interface TrendApi {
  area: { slug: string; label: string };
  windowDays: number;
  totalIncidents: number;
  bullets: Array<{
    kind: "trend" | "dispatch";
    at: string;
    text: string;
    category?: "PERSONS" | "PROPERTY" | "SOCIETY";
  }>;
}

interface InsightsApi {
  area: string;
  windowWeeks: number;
  totalIncidents: number;
  trends: Array<{
    category: "PERSONS" | "PROPERTY" | "SOCIETY";
    weekly: number[];
  }>;
}

/// Convert a local-vs-national ratio into a 0–100 safety index. The mapping
/// is anchored so the user-perceived comparison aligns with what the FBI's
/// own visualizations show:
///   ratio ≤ 0.5  →  score 90 (well below national)
///   ratio = 1.0  →  score 50 (matches national)
///   ratio ≥ 2.0  →  score 10 (well above national)
/// Beyond 2× national the score still has a small floor so the worst case
/// reads as "elevated" rather than nothing, and below 0.5 it caps near 100
/// rather than overshooting.
function ratioToScore(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio < 0) return 50;
  if (ratio <= 0) return 100;
  // Piecewise-linear with diminishing returns at both ends. 100 at ratio 0,
  // 50 at ratio 1, 10 at ratio 2, clamped to [5, 100].
  let raw: number;
  if (ratio <= 1) raw = 100 - 50 * ratio;
  else raw = Math.max(5, 50 - 40 * (ratio - 1));
  return Math.max(5, Math.min(100, Math.round(raw)));
}

function bandFor(score: number): BlockScoreBand {
  if (score >= 80) return "safe";
  if (score >= 50) return "moderate";
  return "elevated";
}

function deriveBlockScore(api: SafetyScoreApi | null): BlockScore | null {
  if (!api || api.rows.length === 0) return null;
  // Average the per-category ratios so a spike in one category doesn't
  // single-handedly tank the index.
  const ratios = api.rows
    .map((r) => (r.nationalPer100k > 0 ? r.localPer100k / r.nationalPer100k : 1))
    .filter((r) => Number.isFinite(r));
  if (ratios.length === 0) return null;
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const score = ratioToScore(avg);
  const band = bandFor(score);
  // Use the actual averaged ratio to make the headline specific instead of
  // generic — "1.8× the national average" reads as a fact, "tracks roughly"
  // reads as filler.
  const mult = avg > 0 && Number.isFinite(avg) ? avg : 1;
  const headline =
    band === "safe"
      ? `${api.area.label} reports below the FBI national rate (about ${mult.toFixed(2)}× national across tracked categories).`
      : band === "moderate"
        ? `${api.area.label} reports close to the FBI national rate (about ${mult.toFixed(2)}× national).`
        : `${api.area.label} reports above the FBI national rate (about ${mult.toFixed(1)}× national).`;
  return {
    score,
    band,
    headline,
    benchmark: { label: api.source.label, url: api.source.url, year: api.source.publishedYear },
  };
}

function deriveThreats(api: TrendApi | null): ThreatItem[] {
  if (!api) return [];
  return api.bullets
    .filter((b) => b.kind === "dispatch")
    .map((b, i) => ({
      id: `${b.at}-${i}`,
      at: b.at,
      description: b.text,
      category: (b.category ?? "SOCIETY") as ThreatItem["category"],
    }));
}

function deriveBaseline(api: InsightsApi | null): BaselinePoint[] {
  if (!api || api.trends.length === 0) return [];
  // Sum the three NIBRS categories' weekly counts into one baseline series.
  // The result is a single line representing total reported incidents per
  // week across the cached window — exactly the macro-historical shape the
  // empty-feed fallback needs.
  const len = Math.max(...api.trends.map((t) => t.weekly.length));
  const summed: number[] = new Array(len).fill(0);
  for (const t of api.trends) {
    for (let i = 0; i < t.weekly.length; i++) summed[i] += t.weekly[i];
  }
  // The /crime-data/insights endpoint returns weekly buckets indexed 0..N
  // with the most recent week LAST. We don't try to attach real calendar
  // dates here — the chart treats the array as ordinal positions and the
  // caption identifies the window.
  const today = Date.now();
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  return summed.map((count, i) => ({
    weekStart: new Date(today - (summed.length - 1 - i) * WEEK).toISOString(),
    count,
  }));
}

/// Custom hook: the SafeZoneTab module's single data source. UI widgets in
/// this folder consume the returned `SafeZoneDataState` as props and never
/// fetch anything themselves.
///
/// Two GET endpoints are joined here:
///   /safezone/safety-score  →  drives BlockScore (FBI-comparison index)
///   /safezone/trend         →  drives the 30-day dispatch feed
///   /crime-data/insights    →  drives the analytical baseline graph
///
/// Loading is true when ANY request is in flight on first mount. Error is
/// the first one we see — partial UI keeps rendering for whichever feed
/// did return. Both `selection.city` and `selection.area` shape the URLs.
export function useSafeZoneData(selection: SafeZoneSelection): SafeZoneDataState {
  // Score + trend support BOTH per-area and citywide queries — we MUST
  // route citywide when no area is picked, because passing the city's
  // slug as a "neighborhood" returns zero incidents from the adapter
  // (city.defaultArea is the city slug, not a neighborhood slug). That
  // produced the all-100 Safety Index regression: zero incidents →
  // ratio 0/364 → ratioToScore(0) = 100 → "Lower than national rate".
  // The 100 score was a false positive masking a missing-data path.
  // INCIDENT: never use a city slug as if it were an area slug. If no
  // area is picked, route to the citywide endpoint variant.
  const areaForApi = selection.area
    ? `area=${encodeURIComponent(selection.area.slug)}&label=${encodeURIComponent(selection.area.label)}`
    : null;
  const cityForApi = `city=${encodeURIComponent(selection.city.slug)}`;
  const scorePath = areaForApi
    ? `/safezone/safety-score?${areaForApi}`
    : `/safezone/safety-score?${cityForApi}`;
  const trendPath = areaForApi
    ? `/safezone/trend?${areaForApi}`
    : `/safezone/trend?${cityForApi}`;
  const insightsQ = selection.area
    ? `neighborhood=${encodeURIComponent(selection.area.slug)}`
    : `jurisdiction=${encodeURIComponent(selection.city.slug)}`;
  const insightsPath = `/crime-data/insights?${insightsQ}`;

  const { data: scoreApi, loading: scoreLoading, error: scoreErr } = useApi<SafetyScoreApi>(scorePath, [scorePath]);
  const { data: trendApi, loading: trendLoading, error: trendErr } = useApi<TrendApi>(trendPath, [trendPath]);
  const { data: insightsApi, loading: insightsLoading, error: insightsErr } = useApi<InsightsApi>(insightsPath, [insightsPath]);

  return useMemo<SafeZoneDataState>(() => ({
    selection,
    blockScore: deriveBlockScore(scoreApi),
    threats: deriveThreats(trendApi),
    baseline: deriveBaseline(insightsApi),
    windowDays: trendApi?.windowDays ?? 30,
    asOf: scoreApi?.asOf ?? null,
    loading: scoreLoading || trendLoading || insightsLoading,
    error: scoreErr ?? trendErr ?? insightsErr ?? null,
  }), [
    selection, scoreApi, trendApi, insightsApi,
    scoreLoading, trendLoading, insightsLoading,
    scoreErr, trendErr, insightsErr,
  ]);
}
