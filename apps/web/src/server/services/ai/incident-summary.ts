import "server-only";
import { aiConfigured, getAIModel } from "./provider";
import { getCrimeMix } from "../crime-data/mix";
import { crimeData } from "../crime-data";
import { cityForArea, cityBySlug } from "../crime-data/cities";

// Per-area / per-city AI incident summary. Sibling to area-brief.ts
// but answers a different question:
//   area-brief.ts → "what kinds of incidents does this area generally see?"
//   incident-summary → "what's been happening here LATELY (last ~30 days)?
//                       any spike or pattern worth knowing about?"
//
// The text is calm + actionable. The structural fields (severity,
// trend, change_pct) are computed from the data itself — NOT from
// the LLM — so they're deterministic and can drive UI badges even
// when the AI is unavailable.

const SYSTEM_PROMPT = `
You are a calm, factual safety summarizer.

Output: ONE short paragraph, 2-3 sentences, no markdown, no headings,
no bullets, plain prose only. Maximum 280 characters.

Tone: matter-of-fact, like a neighborhood-blog headline. Not alarming.

Content: describe what KINDS of recent incidents stand out, name 1-2
specific offense categories from the list verbatim, and surface any
notable trend (spike, decline, stable). If the recent count is
similar to the prior period, say so — don't manufacture drama.

Hard rules:
- NEVER name people, vehicles, or addresses beyond block level.
- NEVER mention demographics (race, ethnicity, religion, age, gender,
  orientation, immigration status).
- NEVER encourage confronting, recording, or approaching anyone.
- Don't make policy claims ("the police should…"); stay descriptive.
`.trim();

export type IncidentSeverity = "low" | "moderate" | "elevated";
export type IncidentTrend = "stable" | "rising" | "falling";

export interface IncidentSummary {
  /// Plain-prose summary from the LLM (or null if AI is disabled).
  summary: string | null;
  /// Deterministic severity bucket derived from the incident-rate
  /// ratio vs the city's typical baseline. Drives a visual badge
  /// in the UI even when the AI text is missing.
  severity: IncidentSeverity;
  /// Direction of change vs the prior equal-length window
  /// (e.g., last 30d vs prior 30d). UI renders an arrow next to
  /// the summary.
  trend: IncidentTrend;
  /// Percent change in incident count vs the prior period. Positive
  /// = up. Surfaced numerically next to the trend arrow.
  changePct: number;
  /// Window applied for the recent count.
  windowDays: number;
  /// Recent + prior counts for transparency.
  recentCount: number;
  priorCount: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — recent-activity summaries shouldn't lag much further
const cache = new Map<string, { fetchedAt: number; data: IncidentSummary }>();

interface BuildOpts {
  /// Area slug for a per-neighborhood summary. Mutually exclusive
  /// with cityOnly — pass one or the other.
  area?: string;
  /// Set true for a citywide summary (no specific area).
  cityOnly?: { citySlug: string };
  /// Recent window in days. Default 30 (matches the Crime Chart
  /// default + the news panel default).
  windowDays?: number;
}

const sanitize = (s: string, maxLen = 80): string =>
  s.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLen);

function classifySeverity(rateRatio: number): IncidentSeverity {
  if (rateRatio < 0.85) return "low";
  if (rateRatio < 1.25) return "moderate";
  return "elevated";
}

function classifyTrend(recent: number, prior: number): { trend: IncidentTrend; changePct: number } {
  if (prior === 0) {
    return { trend: recent === 0 ? "stable" : "rising", changePct: recent === 0 ? 0 : 100 };
  }
  const pct = ((recent - prior) / prior) * 100;
  if (Math.abs(pct) < 10) return { trend: "stable", changePct: Math.round(pct) };
  return { trend: pct > 0 ? "rising" : "falling", changePct: Math.round(pct) };
}

export async function generateIncidentSummary(opts: BuildOpts): Promise<IncidentSummary | null> {
  const windowDays = opts.windowDays ?? 30;
  // v95p32 — cache key now scopes by city slug so a neighborhood name
  // shared across cities (e.g. "downtown" in Sacramento + SF + Detroit)
  // doesn't collide. Bug parity with the Railway-side service: an
  // in-memory Map keyed by area alone was serving the first-computed
  // city's summary to every other city that shared the neighborhood
  // slug. This is the duplicate cache the user saw "still apparent
  // after all audits" — the API fix alone didn't help because the
  // web app's server-rendered Neighborhood Watch tab has its own
  // in-process cache here.
  const citySlug = opts.area
    ? cityForArea(opts.area).slug
    : (opts.cityOnly?.citySlug ?? "unknown");
  const cacheKey = `v2::${citySlug}::${opts.area ?? "_city_"}::${windowDays}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;

  // Pull counts: recent window + prior equal-length window for trend.
  const nowMs = Date.now();
  const recentSince = new Date(nowMs - windowDays * 24 * 60 * 60 * 1000);
  const priorSince = new Date(nowMs - 2 * windowDays * 24 * 60 * 60 * 1000);

  let cityLabel = "Unknown";
  let areaLabel: string | null = null;
  let recentCount = 0;
  let priorCount = 0;
  let topOffenses: Array<{ offense: string; count: number; category: string }> = [];

  if (opts.area) {
    const city = cityForArea(opts.area);
    cityLabel = city.label;
    areaLabel = opts.area;
    const mix = await getCrimeMix(opts.area).catch(() => null);
    topOffenses = (mix?.topOffenses ?? []).slice(0, 6).map((o) => ({
      offense: o.offense, count: o.count, category: o.category,
    }));
    // Use the area's incident stream to count recent vs prior.
    const recent = await crimeData.getIncidents(opts.area, { limit: 2000, since: recentSince }).catch(() => []);
    const prior = await crimeData.getIncidents(opts.area, { limit: 2000, since: priorSince }).catch(() => []);
    recentCount = recent.length;
    // priorCount = total of prior 2-window window minus recent (= the equal-length window BEFORE recent)
    priorCount = Math.max(0, prior.length - recent.length);
  } else if (opts.cityOnly) {
    const city = cityBySlug(opts.cityOnly.citySlug);
    if (!city) return null;
    cityLabel = city.label;
    const cw = await crimeData.getCitywide(opts.cityOnly.citySlug, { windowDays }).catch(() => null);
    if (!cw) return null;
    topOffenses = (cw.topOffenses ?? []).slice(0, 6).map((o) => ({
      offense: o.offense, count: o.count, category: "" as string,
    }));
    recentCount = cw.totalIncidents;
    // For citywide trend, pull a 2× window and subtract.
    const wide = await crimeData.getCitywide(opts.cityOnly.citySlug, { windowDays: windowDays * 2 }).catch(() => null);
    if (wide) priorCount = Math.max(0, wide.totalIncidents - recentCount);
    // v54 — see apps/api/.../incident-summary.service.ts for the same
    // fallback rationale. Cities whose adapter cache has no rows in
    // the last 30d (Boston bundled snapshot, KC monthly refresh, LA
    // NIBRS) returned summary:null previously because the LLM gate
    // requires topOffenses.length > 0. Use the wider window's
    // offenses for context when recent is empty.
    if (recentCount === 0 && wide && wide.totalIncidents > 0 && topOffenses.length === 0) {
      topOffenses = (wide.topOffenses ?? []).slice(0, 6).map((o) => ({
        offense: o.offense, count: o.count, category: "" as string,
      }));
    }
    // v57 — second fallback. v54 covered "recent=0 but prior has
    // data." Some adapters publish data so sparsely that BOTH 30d
    // and 60d windows are empty (LA NIBRS quarterly publish is the
    // classic case). Pull a year of data so the LLM still has
    // offense-mix context. If even the year-long window is empty,
    // we fall through to summary:null and the UI's deterministic-
    // fields-only path renders.
    if (topOffenses.length === 0) {
      const yearLong = await crimeData.getCitywide(opts.cityOnly.citySlug, { windowDays: 365 }).catch(() => null);
      if (yearLong && yearLong.totalIncidents > 0) {
        topOffenses = (yearLong.topOffenses ?? []).slice(0, 6).map((o) => ({
          offense: o.offense, count: o.count, category: "" as string,
        }));
      }
    }
  } else {
    return null;
  }

  const { trend, changePct } = classifyTrend(recentCount, priorCount);

  // Severity ratio: recent rate vs prior rate (equal window). Since
  // they're same-length windows the ratio of counts == ratio of rates.
  const rateRatio = priorCount > 0 ? recentCount / priorCount : (recentCount > 0 ? 1.5 : 0);
  const severity = classifySeverity(rateRatio);

  // Build the LLM prompt. The deterministic fields (counts + trend)
  // pass through to the response regardless of LLM availability.
  let summary: string | null = null;
  if (aiConfigured() && topOffenses.length > 0) {
    const offenseList = topOffenses
      .map((o) => `${sanitize(o.offense, 60)} (${o.count})`)
      .join("; ");
    const userPrompt = `
City: ${sanitize(cityLabel)}
${areaLabel ? `Neighborhood: ${sanitize(areaLabel)}` : "Scope: citywide"}
Recent window: last ${windowDays} days
Recent incident count: ${recentCount}
Prior ${windowDays}-day count (for trend): ${priorCount}
Change: ${changePct >= 0 ? "+" : ""}${changePct}% (${trend})
Severity bucket vs prior: ${severity}
Top offenses in recent window:
${offenseList}

Write the one-paragraph summary now.
`.trim();
    try {
      const model = await getAIModel();
      if (model) {
        const { generateText } = await import("ai");
        const res = await generateText({
          model: model as Parameters<typeof generateText>[0]["model"],
          system: SYSTEM_PROMPT,
          prompt: userPrompt,
          temperature: 0.25,
        });
        summary = res.text.trim()
          .replace(/^#+\s*/gm, "")
          .replace(/\*\*([^*]+)\*\*/g, "$1");
        if (summary.length > 400) summary = summary.slice(0, 400);
      }
    } catch (err) {
      console.warn("[incident-summary] generation failed:", (err as Error).message);
    }
  }

  const data: IncidentSummary = {
    summary,
    severity,
    trend,
    changePct,
    windowDays,
    recentCount,
    priorCount,
  };
  cache.set(cacheKey, { fetchedAt: Date.now(), data });
  return data;
}
