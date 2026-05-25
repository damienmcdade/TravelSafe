import { aiConfigured, getAIModel } from "./provider.js";
import { getCrimeMix } from "@travelsafe/crime-data/mix";
import { crimeData } from "@travelsafe/crime-data/dispatcher";
import { cityForArea, cityBySlug } from "@travelsafe/crime-data/cities";

// Per-area / per-city AI incident summary. Ported from apps/web for
// v38; same prompt + algorithm + deterministic fields, just hosted on
// Railway alongside area-brief + incident-explain.

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
  summary: string | null;
  severity: IncidentSeverity;
  trend: IncidentTrend;
  changePct: number;
  windowDays: number;
  recentCount: number;
  priorCount: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { fetchedAt: number; data: IncidentSummary }>();

interface BuildOpts {
  area?: string;
  cityOnly?: { citySlug: string };
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
  const cacheKey = `${opts.area ?? "city:" + opts.cityOnly?.citySlug}::${windowDays}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;

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
    const recent = await crimeData.getIncidents(opts.area, { limit: 2000, since: recentSince }).catch(() => []);
    const prior = await crimeData.getIncidents(opts.area, { limit: 2000, since: priorSince }).catch(() => []);
    recentCount = recent.length;
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
    const wide = await crimeData.getCitywide(opts.cityOnly.citySlug, { windowDays: windowDays * 2 }).catch(() => null);
    if (wide) priorCount = Math.max(0, wide.totalIncidents - recentCount);
    // v54 — fallback: when the recent window has zero incidents but
    // the prior window has data, the adapter's cache simply doesn't
    // hold last-30-day rows (Boston bundled snapshot, KC monthly
    // refresh, LA NIBRS quarterly). In that case use the WIDE window
    // for the LLM's offense-mix context so the summary still
    // generates something useful — the trend/severity math still
    // reflects the truth (recent=0 → falling -100%), but the AI can
    // describe what offense KINDS are characteristic instead of
    // returning summary:null.
    if (recentCount === 0 && wide && wide.totalIncidents > 0 && topOffenses.length === 0) {
      topOffenses = (wide.topOffenses ?? []).slice(0, 6).map((o) => ({
        offense: o.offense, count: o.count, category: "" as string,
      }));
    }
    // v57 — second fallback. v54 covered "recent=0 but prior has
    // data." Some adapters publish data so sparsely that BOTH 30d
    // and 60d windows are empty (LA NIBRS quarterly publish is the
    // classic case). When that happens, pull a year of data so the
    // LLM still has offense-mix context to describe. The trend math
    // stays at "no recent reports" — we just hydrate topOffenses
    // so the LLM call gates open. If even the year-long window is
    // empty (truly stale adapter), we fall through to summary:null
    // which the UI handles with the deterministic-fields-only path.
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
  const rateRatio = priorCount > 0 ? recentCount / priorCount : (recentCount > 0 ? 1.5 : 0);
  const severity = classifySeverity(rateRatio);

  let summary: string | null = null;
  if (aiConfigured() && topOffenses.length > 0) {
    const offenseList = topOffenses
      .map((o) => `${sanitize(o.offense, 60)} (${o.count})`)
      .join("; ");
    // v54 — when recentCount is 0 but we still have topOffenses, the
    // offense list came from the WIDER window (the v54 fallback).
    // Tell the LLM so it doesn't write "in the last 30 days these
    // categories…" when there were zero incidents in that window.
    const offensesFromWideWindow = recentCount === 0 && topOffenses.length > 0;
    const offensesScope = offensesFromWideWindow
      ? `Top offenses (from a longer ~${windowDays * 2}-day window — no incidents in the last ${windowDays} days):`
      : `Top offenses in recent window:`;
    const userPrompt = `
City: ${sanitize(cityLabel)}
${areaLabel ? `Neighborhood: ${sanitize(areaLabel)}` : "Scope: citywide"}
Recent window: last ${windowDays} days
Recent incident count: ${recentCount}
Prior ${windowDays}-day count (for trend): ${priorCount}
Change: ${changePct >= 0 ? "+" : ""}${changePct}% (${trend})
Severity bucket vs prior: ${severity}
${offensesScope}
${offenseList}

Write the one-paragraph summary now.${offensesFromWideWindow ? " Acknowledge plainly that the most recent " + windowDays + "-day window had no published reports yet, then describe what offense categories are characteristic of this area from the longer window." : ""}
`.trim();
    try {
      const model = await getAIModel();
      if (model) {
        const { generateText } = await import("ai");
        const res = await generateText({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model: model as any,
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
