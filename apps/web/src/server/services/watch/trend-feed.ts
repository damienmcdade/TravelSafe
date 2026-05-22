import "server-only";
import { crimeData } from "../crime-data";
import { cityForArea } from "../crime-data/cities";

/// Trend Feed — produces a bulleted chronological summary of the past
/// 30 days for a given area, plus week-over-week shift markers. Bullets
/// are grouped into:
///   1. Week-over-week trend summary (1-3 bullets)
///   2. Recent dispatches/reports, chronological newest → oldest, capped
///   at ~12 entries so it stays glanceable
///
/// Every bullet cites the same official police adapter that powers the
/// rest of the app. No commentary, no inference — just the feed in
/// readable English.

const DAY = 24 * 60 * 60 * 1000;

export interface TrendBullet {
  /// Either "trend" (week-over-week summary) or "dispatch" (single incident).
  kind: "trend" | "dispatch";
  /// ISO timestamp for sorting + display.
  at: string;
  /// One-line prose bullet — already formatted for the UI.
  text: string;
  /// Optional NIBRS category color tag for the UI.
  category?: "PERSONS" | "PROPERTY" | "SOCIETY";
}

export interface TrendResponse {
  city: { slug: string; label: string };
  area: { slug: string; label: string };
  /// First-day cutoff used for the 30-day window.
  windowStart: string;
  /// Total recorded incidents in the window for this area.
  totalIncidents: number;
  bullets: TrendBullet[];
  /// Hour-of-day distribution across the 30-day window. Four buckets
  /// (late_night = 12am-6am, morning = 6am-12pm, afternoon = 12pm-6pm,
  /// evening = 6pm-12am) plus the dominant period name + concentration
  /// percentage. Null when the window is empty.
  timeOfDay: {
    buckets: { late_night: number; morning: number; afternoon: number; evening: number };
    dominantPeriod: "late_night" | "morning" | "afternoon" | "evening";
    dominantPct: number;
  } | null;
  source: { label: string; url: string };
  disclaimer: string;
}

function ymd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/// Bucket an incident's hour-of-day into one of four periods. The buckets
/// align with how people actually plan their day around safety: "late
/// night" is when the bars close and walking home reads differently,
/// "morning" is commute, etc.
type TimePeriod = "late_night" | "morning" | "afternoon" | "evening";
const PERIOD_LABEL: Record<TimePeriod, string> = {
  late_night: "late night (12am-6am)",
  morning:    "morning (6am-12pm)",
  afternoon:  "afternoon (12pm-6pm)",
  evening:    "evening (6pm-12am)",
};
function periodFromHour(h: number): TimePeriod {
  if (h < 6)  return "late_night";
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

interface TimeOfDayBuckets { late_night: number; morning: number; afternoon: number; evening: number }

/// Compute a time-of-day breakdown across a window of incidents.
/// Returns null when the window is empty (no signal to report). When
/// there's data, returns the four bucket counts plus the dominant
/// period and what percentage of the window fell into it.
function timeOfDayAnalysis(incidents: Array<{ occurredAt: string }>):
  { buckets: TimeOfDayBuckets; dominantPeriod: TimePeriod; dominantPct: number } | null {
  if (incidents.length === 0) return null;
  const buckets: TimeOfDayBuckets = { late_night: 0, morning: 0, afternoon: 0, evening: 0 };
  for (const i of incidents) {
    const t = new Date(i.occurredAt);
    if (Number.isNaN(t.getTime())) continue;
    buckets[periodFromHour(t.getHours())] += 1;
  }
  const total = buckets.late_night + buckets.morning + buckets.afternoon + buckets.evening;
  if (total === 0) return null;
  const entries = Object.entries(buckets) as Array<[TimePeriod, number]>;
  entries.sort((a, b) => b[1] - a[1]);
  const [dominantPeriod, dominantCount] = entries[0];
  return { buckets, dominantPeriod, dominantPct: Math.round((dominantCount / total) * 100) };
}

/// Citywide variant. Aggregates the 30-day trend feed across every tracked
/// neighborhood for the given city. Used as the default Trend Feed view
/// when the user hasn't drilled into a specific neighborhood. Same
/// response shape as getTrendForArea so the page renders both with one
/// component.
export async function getCitywideTrend(citySlug: string): Promise<TrendResponse> {
  const { cityBySlug } = await import("../crime-data/cities");
  const city = cityBySlug(citySlug) ?? cityForArea("");
  const areas = await city.discover().catch(() => []);
  const now = Date.now();
  const cutoff = new Date(now - 30 * DAY);

  // Concatenate the 30-day window across every neighborhood. The adapter
  // cache de-duplicates upstream pulls so this is one fetch per adapter
  // regardless of how many neighborhoods we iterate.
  const inWindow: Array<{
    occurredAt: string;
    nibrsCategory: "PERSONS" | "PROPERTY" | "SOCIETY";
    ibrOffenseDescription: string;
    blockLabel?: string;
    area: string;
  }> = [];
  // Parallelize same as getCitywideSafetyScore — adapter cache means the
  // upstream feed is hit once, but the per-area fan-out into our cache
  // adds up for large cities.
  const perArea = await Promise.all(
    areas.map(async (a) => ({
      label: a.label,
      rows: await crimeData.getIncidents(a.slug, { limit: 5000 }).catch(() => []),
    })),
  );
  for (const { label, rows } of perArea) {
    for (const r of rows) {
      if (new Date(r.occurredAt) >= cutoff) {
        inWindow.push({
          occurredAt: r.occurredAt,
          nibrsCategory: r.nibrsCategory as "PERSONS" | "PROPERTY" | "SOCIETY",
          ibrOffenseDescription: r.ibrOffenseDescription,
          blockLabel: r.blockLabel,
          area: label,
        });
      }
    }
  }
  inWindow.sort((x, y) => +new Date(y.occurredAt) - +new Date(x.occurredAt));

  const recentWeek = new Date(now - 7 * DAY);
  const priorWeek = new Date(now - 14 * DAY);
  const bucketed = {
    recent: { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 },
    prior:  { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 },
  };
  for (const i of inWindow) {
    const t = new Date(i.occurredAt);
    if (t >= recentWeek) bucketed.recent[i.nibrsCategory] += 1;
    else if (t >= priorWeek) bucketed.prior[i.nibrsCategory] += 1;
  }

  const trendBullets: TrendBullet[] = [];
  for (const cat of ["PERSONS", "PROPERTY", "SOCIETY"] as const) {
    const r = bucketed.recent[cat];
    const p = bucketed.prior[cat];
    if (r === 0 && p === 0) continue;
    const delta = r - p;
    const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    const friendly = cat === "PERSONS" ? "violent / persons"
                    : cat === "PROPERTY" ? "property"
                    : "society / public-order";
    const text = delta === 0
      ? `${friendly} reports flat week-over-week across ${city.label} (${r} this week, ${p} the week before).`
      : `${friendly} reports ${direction} ${Math.abs(delta)} week-over-week across ${city.label} (${r} this week, ${p} the week before).`;
    trendBullets.push({
      kind: "trend",
      at: new Date(now).toISOString(),
      text,
      category: cat,
    });
  }

  // Citywide time-of-day pattern — same threshold as the per-area path
  // (30% concentration required to be "meaningful").
  const tod = timeOfDayAnalysis(inWindow);
  if (tod && tod.dominantPct >= 30) {
    trendBullets.push({
      kind: "trend",
      at: new Date(now).toISOString(),
      text: `Most reports across ${city.label} occur during ${PERIOD_LABEL[tod.dominantPeriod]} — ${tod.dominantPct}% of the past 30 days landed in that window.`,
    });
  }

  // Recent dispatches across the whole city — include the neighborhood name
  // in each bullet so users see which area the dispatch came from. Cap at
  // 12 for glanceability, same as the area path.
  const dispatchBullets: TrendBullet[] = inWindow.slice(0, 12).map((i) => ({
    kind: "dispatch",
    at: i.occurredAt,
    text: `${ymd(i.occurredAt)} · ${i.area} — ${i.ibrOffenseDescription}${i.blockLabel ? ` near ${i.blockLabel}` : ""}.`,
    category: i.nibrsCategory,
  }));

  // Cite the same adapter's provenance — every adapter exposes the same
  // shape, so we can sample the first area's stats for the source line.
  const sample = areas.length > 0
    ? await crimeData.getAreaStats(areas[0].slug).catch(() => null)
    : null;

  return {
    city: { slug: city.slug, label: city.label },
    area: { slug: city.slug, label: `${city.label} (citywide)` },
    windowStart: cutoff.toISOString(),
    totalIncidents: inWindow.length,
    bullets: [...trendBullets, ...dispatchBullets],
    timeOfDay: tod,
    source: {
      label: sample?.provenance.source ?? `${city.label} police open-data feed`,
      url: sample?.provenance.datasetUrl ?? "about:blank",
    },
    disclaimer:
      "Bullets reflect the most recent 30 days of incidents the city's official " +
      `police open-data feed has published across every tracked ${city.label} ` +
      "neighborhood. Week-over-week shifts compare days 0-7 to days 8-14; if " +
      "the feed has a publishing lag longer than seven days, the 'recent week' " +
      "bucket may be sparse. None of this is a prediction — only what has " +
      "already been reported.",
  };
}

export async function getTrendForArea(areaSlug: string, areaLabel: string): Promise<TrendResponse> {
  const city = cityForArea(areaSlug);
  const now = Date.now();
  const cutoff = new Date(now - 30 * DAY);

  // Pull a generous batch — the adapter cache holds up to 5k rows for the
  // area, which is far more than 30 days for any realistic neighborhood.
  // We filter down to the 30-day window client-side.
  const all = await crimeData.getIncidents(areaSlug, { limit: 5000 }).catch(() => []);
  const inWindow = all.filter((i) => new Date(i.occurredAt) >= cutoff);
  inWindow.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));

  // Bucket the window into the most recent 7 days vs the 7 days before that,
  // by NIBRS group, so we can emit a week-over-week shift summary.
  const recentWeek = new Date(now - 7 * DAY);
  const priorWeek = new Date(now - 14 * DAY);
  const bucketed = { recent: { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 },
                     prior:  { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 } };
  for (const i of inWindow) {
    const t = new Date(i.occurredAt);
    if (t >= recentWeek) bucketed.recent[i.nibrsCategory as "PERSONS" | "PROPERTY" | "SOCIETY"] += 1;
    else if (t >= priorWeek) bucketed.prior[i.nibrsCategory as "PERSONS" | "PROPERTY" | "SOCIETY"] += 1;
  }

  const trendBullets: TrendBullet[] = [];
  for (const cat of ["PERSONS", "PROPERTY", "SOCIETY"] as const) {
    const r = bucketed.recent[cat];
    const p = bucketed.prior[cat];
    if (r === 0 && p === 0) continue;
    const delta = r - p;
    const direction =
      delta > 0 ? "up" :
      delta < 0 ? "down" : "flat";
    const friendly = cat === "PERSONS" ? "violent / persons"
                    : cat === "PROPERTY" ? "property"
                    : "society / public-order";
    const text = delta === 0
      ? `${friendly} reports flat week-over-week (${r} this week, ${p} the week before).`
      : `${friendly} reports ${direction} ${Math.abs(delta)} week-over-week (${r} this week, ${p} the week before).`;
    trendBullets.push({
      kind: "trend",
      at: new Date(now).toISOString(),
      text,
      category: cat,
    });
  }

  // Time-of-day pattern across the full 30-day window. Surface only when
  // a meaningful dominant period exists (>= 30% concentration) so we don't
  // emit a generic "25% in each quarter" non-insight.
  const tod = timeOfDayAnalysis(inWindow);
  if (tod && tod.dominantPct >= 30) {
    trendBullets.push({
      kind: "trend",
      at: new Date(now).toISOString(),
      text: `Most reports in ${areaLabel} occur during ${PERIOD_LABEL[tod.dominantPeriod]} — ${tod.dominantPct}% of the past 30 days landed in that window.`,
    });
  }

  // Recent dispatches — top 12 by recency, formatted as bullets.
  const dispatchBullets: TrendBullet[] = inWindow.slice(0, 12).map((i) => ({
    kind: "dispatch",
    at: i.occurredAt,
    text: `${ymd(i.occurredAt)} — ${i.ibrOffenseDescription}${i.blockLabel ? ` near ${i.blockLabel}` : ""}.`,
    category: i.nibrsCategory as "PERSONS" | "PROPERTY" | "SOCIETY",
  }));

  // Get the adapter's source URL for citation.
  const sample = await crimeData.getAreaStats(areaSlug).catch(() => null);

  return {
    city: { slug: city.slug, label: city.label },
    area: { slug: areaSlug, label: areaLabel },
    windowStart: cutoff.toISOString(),
    totalIncidents: inWindow.length,
    bullets: [...trendBullets, ...dispatchBullets],
    timeOfDay: tod,
    source: {
      label: sample?.provenance.source ?? `${city.label} police open-data feed`,
      url: sample?.provenance.datasetUrl ?? "about:blank",
    },
    disclaimer:
      "Bullets reflect the most recent 30 days of incidents the city's police " +
      "open-data feed has published for this neighborhood. Week-over-week shifts " +
      "compare days 0-7 to days 8-14; if the city's feed has a publishing lag " +
      "longer than seven days, the 'recent week' bucket may be sparse. None of " +
      "this is a prediction — only what has already been reported.",
  };
}
