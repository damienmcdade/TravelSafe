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
    /// Citywide annualized rate — the PRIMARY comparison anchor for
    /// per-area scoring. Added in the methodology rebase (commit
    /// b284f06). Citywide-mode responses set this equal to localPer100k.
    cityPer100k: number;
    cityDeltaPct: number;
    /// FBI national rate — kept for citywide comparisons where it's
    /// the right anchor, and as a secondary reference in the UI.
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

/// Convert a local-vs-baseline ratio into a 0–100 safety index.
///
/// PRIOR DESIGN had a steep linear collapse: ratio 1 → score 50,
/// ratio 2 → score 10, then floored at 5. That was tuned for the
/// neighborhood-vs-city ratios (typical range 0.3–2.5×) where the
/// citywide baseline keeps most readings inside the score's
/// discriminating range. But for the CITYWIDE-vs-NATIONAL pairing,
/// urban cities consistently read 2–7× the national rate (national
/// includes rural + suburban, which pulls the baseline well below
/// any large city), so EVERY major city collapsed to score=5 and
/// users couldn't tell a 2× city from a 7× city — they all read
/// "elevated, score 5".
///
/// NEW MAPPING uses a smooth 1/(1+k(ratio−1)) decay above ratio 1
/// so the [1, 10] range stays discriminating:
///   ratio 0    → 100  (no reports)
///   ratio 0.5  →  80  (well below baseline, A-tier)
///   ratio 1.0  →  60  (matches baseline)
///   ratio 2.0  →  35
///   ratio 3.0  →  25
///   ratio 5.0  →  16
///   ratio 10   →   8  (very high)
///   ratio > 12 →   5  (floor)
function ratioToScore(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio < 0) return 50;
  if (ratio <= 0) return 100;
  let raw: number;
  if (ratio <= 1) {
    // Linear 100 → 60 in [0, 1].
    raw = 100 - 40 * ratio;
  } else {
    // Smooth decay 60 / (1 + 0.7(r−1)) for r > 1. Gives meaningful
    // separation through ratio ~12 before the floor kicks in.
    raw = 60 / (1 + 0.7 * (ratio - 1));
  }
  return Math.max(5, Math.min(100, Math.round(raw)));
}

function bandFor(score: number): BlockScoreBand {
  if (score >= 80) return "safe";
  if (score >= 50) return "moderate";
  return "elevated";
}

function deriveBlockScore(api: SafetyScoreApi | null): BlockScore | null {
  if (!api || api.rows.length === 0) return null;

  // INCIDENT-PREVENTION ZERO-COUNT GUARD (2026-05-23): a zero-incident
  // window must NOT score 100. The previous behavior returned score:100
  // with a "no recent reports" headline, but the WIDGET renders 100 as
  // a safe-band ring with "Fewer reports than national rate" labeling
  // and a 100-out-of-100 numeric, so users who landed on a no-data
  // neighborhood saw an emphatic "safe" verdict for what was actually
  // a data gap. The all-neighborhoods-show-100 production bug came
  // from this: every adapter-quiet area read as a perfect 100.
  //
  // Return null instead — the widget's `unavailable` branch then
  // renders an explicit "data unavailable" panel. Same approach the
  // SafetyScoreResponse.grade field now takes via "N/A" at the
  // letter-grade layer.
  const totalCount = api.rows.reduce((s, r) => s + (r.count || 0), 0);
  if (totalCount === 0) return null;

  // P0 SCORING FIX (2026-05-23): the BlockScore previously averaged
  // local/NATIONAL ratios. For most urban neighborhoods the national
  // anchor produced ratios of 3–30× (cities concentrate reportable
  // activity, neighborhoods concentrate further; national averages
  // rural+suburban+urban into one denominator). ratioToScore floors
  // at 5 above ratio 2, so the vast majority of areas registered
  // a 5/100 score regardless of how they actually compared to peers.
  //
  // Fix: per-area scoring uses local/CITY ratios — the nearest
  // official baseline available everywhere. Citywide-mode responses
  // (where area === city) get cityPer100k === localPer100k by
  // construction, which would always yield ratio 1.0 and score 50.
  // For citywide we instead fall back to the national anchor — that
  // IS the right comparison when the area being scored is the city
  // itself. Same anchor logic the letter-grade rebase already used.
  const isCitywide = api.area.slug === api.city.slug;
  const ratios = api.rows
    .map((r) => {
      if (isCitywide) {
        return r.nationalPer100k > 0 ? r.localPer100k / r.nationalPer100k : 1;
      }
      return r.cityPer100k > 0 ? r.localPer100k / r.cityPer100k : 1;
    })
    .filter((r) => Number.isFinite(r));
  if (ratios.length === 0) return null;
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const score = ratioToScore(avg);
  const band = bandFor(score);
  const mult = avg > 0 && Number.isFinite(avg) ? avg : 1;
  const anchor = isCitywide ? "the FBI national rate" : `${api.city.label} citywide`;
  const headline =
    band === "safe"
      ? `${api.area.label} reports below ${anchor} (about ${mult.toFixed(2)}× across tracked categories).`
      : band === "moderate"
        ? `${api.area.label} reports close to ${anchor} (about ${mult.toFixed(2)}×).`
        : `${api.area.label} reports above ${anchor} (about ${mult.toFixed(1)}×).`;
  return {
    score,
    band,
    headline,
    benchmark: { label: api.source.label, url: api.source.url, year: api.source.publishedYear },
  };
}

// Multi-signal confidence derivation. Combines:
//   1. AGE — fresh adapter rows (< 2h) are "developing" because the
//      initial report can be revised/retracted as officers update the
//      case file. Rows older than 2h are stable enough to carry the
//      full "verified" badge.
//   2. CLUSTERING — when multiple incidents of the same category land
//      in the same 24h window, each one's confidence is corroborated
//      by the others (police got multiple independent reports of the
//      same kind of activity). A row that would otherwise be
//      "developing" gets promoted to "verified" if 2+ peers in
//      the same category landed within 24h.
//   3. SOURCE — all rows in our feed come from official police
//      adapters, so source credibility defaults to "verified" tier.
//      (Community-sourced rows from posts use a separate
//      "community-confirmed" / "unverified" path; not unified here
//      because they don't flow through this hook today.)
const DEVELOPING_THRESHOLD_MS = 2 * 60 * 60 * 1000;
const CLUSTERING_WINDOW_MS = 24 * 60 * 60 * 1000;
const CLUSTERING_THRESHOLD = 2; // 2+ peers in same category within 24h → corroborated

function deriveThreats(api: TrendApi | null): ThreatItem[] {
  if (!api) return [];
  const now = Date.now();
  const dispatches = api.bullets.filter((b) => b.kind === "dispatch");
  // First pass: bucket by category for clustering lookups.
  const peersByCategory = new Map<string, number[]>(); // category → list of incident timestamps
  for (const b of dispatches) {
    const t = +new Date(b.at);
    if (!Number.isFinite(t)) continue;
    const cat = b.category ?? "SOCIETY";
    const list = peersByCategory.get(cat) ?? [];
    list.push(t);
    peersByCategory.set(cat, list);
  }
  return dispatches.map((b, i) => {
    const at = +new Date(b.at);
    const age = Number.isFinite(at) ? now - at : Number.MAX_SAFE_INTEGER;
    const cat = (b.category ?? "SOCIETY") as ThreatItem["category"];
    // Count peer incidents in the same category that landed within
    // the clustering window of this one (excluding self).
    const peers = peersByCategory.get(cat) ?? [];
    let peerCount = 0;
    for (const pt of peers) {
      if (pt === at) continue;
      if (Math.abs(pt - at) <= CLUSTERING_WINDOW_MS) peerCount += 1;
    }
    let confidence: ThreatItem["confidence"];
    if (age < DEVELOPING_THRESHOLD_MS) {
      // Fresh row — promote to verified ONLY if clustering corroborates.
      confidence = peerCount >= CLUSTERING_THRESHOLD ? "verified" : "developing";
    } else {
      confidence = "verified";
    }
    return {
      id: `${b.at}-${i}`,
      at: b.at,
      description: b.text,
      category: cat,
      confidence,
    };
  });
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
  // Citywide: hit the new ?city= mode on /crime-data/insights. Previously
  // we passed `jurisdiction=<citySlug>` which the route treated as an
  // area slug and returned zero incidents → the trend graph went silently
  // empty. Same class of bug as the Safety Index all-100 regression.
  const insightsQ = selection.area
    ? `neighborhood=${encodeURIComponent(selection.area.slug)}`
    : `city=${encodeURIComponent(selection.city.slug)}`;
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
