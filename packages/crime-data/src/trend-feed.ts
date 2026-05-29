import { crimeData } from "./dispatcher.js";
import { cityForArea } from "./cities.js";
import { dedupe } from "./lib/inflight.js";
import { displayOffenseLabel } from "./lib/offense-display-label.js";

// v96p2 — hoisted; used by both citywide and per-area dispatch
// bullet construction. Per the v95p18 directive every event in the
// chosen interval should be included; 5000 ≈ 30 d × 167/day worst
// case is enough headroom for the UI cap (which is the visible cap)
// without unbounded payload growth.
const DISPATCH_CAP = 5000;

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
export async function getCitywideTrend(citySlug: string, opts?: { windowDays?: number }): Promise<TrendResponse> {
  const wd = opts?.windowDays ?? 30;
  return dedupe(`trend:${citySlug}:${wd}`, () => computeCitywideTrend(citySlug, opts));
}

async function computeCitywideTrend(citySlug: string, opts?: { windowDays?: number }): Promise<TrendResponse> {
  const { cityBySlug } = await import("./cities.js");
  const city = cityBySlug(citySlug) ?? cityForArea("");
  const areas = await city.discover().catch(() => []);
  const now = Date.now();
  const windowDays = Math.max(1, Math.min(180, opts?.windowDays ?? 30));

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
  // v90p7 — anchor window on the freshest available row across the whole
  // city (or now, whichever is older). Pre-v90p7 a fixed `now - 30d`
  // cutoff returned 0 bullets whenever the adapter was 30+ days stale.
  let maxT = 0;
  for (const { rows } of perArea) for (const r of rows) {
    const t = +new Date(r.occurredAt);
    if (Number.isFinite(t) && t > maxT && t <= now) maxT = t;
  }
  const anchorMs = maxT > 0 ? maxT : now;
  const cutoff = new Date(anchorMs - windowDays * DAY);
  // Epoch-0 observability: adapters that hit a date-parse fallback emit
  // occurredAt = "1970-01-01T..." rather than dropping the row. Those rows
  // survive into the cache but the cutoff filter below silently excludes
  // them, which historically masked upstream schema drift (e.g. the
  // Boston "+00" offset bug). Count them per city so any future regression
  // shows up in logs instead of as a silent "0 dispatches in last 30 days".
  let epoch0Count = 0;
  let totalRows = 0;
  for (const { label, rows } of perArea) {
    for (const r of rows) {
      totalRows += 1;
      const t = +new Date(r.occurredAt);
      if (!Number.isFinite(t) || t <= 86_400_000) { epoch0Count += 1; continue; }
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
  if (totalRows > 0 && epoch0Count / totalRows > 0.1) {
    console.warn(`[trend-feed] ${city.slug} citywide: ${epoch0Count}/${totalRows} (${Math.round(100*epoch0Count/totalRows)}%) rows had unparseable/epoch-0 timestamps — adapter date-parse fallback likely degraded`);
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
      text: `Most reports across ${city.label} occur during ${PERIOD_LABEL[tod.dominantPeriod]} — ${tod.dominantPct}% of the past ${windowDays} days landed in that window.`,
    });
  }

  // Recent dispatches across the whole city — include the neighborhood
  // name in each bullet so users see which area the dispatch came from.
  // Sort by occurredAt DESC across the full window so bullets read
  // newest-first chronologically (bug history at line 218 explains the
  // global-sort fix).
  //
  // v95p18 — cap raised from 200 → 5000 per user directive to
  // "include all events from time interval." 30 days × 200/day worst
  // case = 6000, so 5000 covers nearly every realistic window without
  // unbounded payload growth. The client cap on ThreatFeed is the UI
  // budget; this server cap exists only as a payload safety net.
  const sortedWindow = [...inWindow].sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
  const dispatchBullets: TrendBullet[] = sortedWindow.slice(0, DISPATCH_CAP).map((i) => ({
    kind: "dispatch",
    at: i.occurredAt,
    // v96p2-followup — run the raw upstream label through
    // displayOffenseLabel server-side. The chart legend already does
    // this client-side, but the dispatches list shipped raw strings
    // ("ALL OTHER OFFENSES") and the user saw two different labels
    // for the same bucket on the same page.
    text: `${ymd(i.occurredAt)} · ${i.area} — ${displayOffenseLabel(i.ibrOffenseDescription)}${i.blockLabel ? ` near ${i.blockLabel}` : ""}.`,
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
      `Bullets reflect the most recent ${windowDays} days of incidents the city's official ` +
      `police open-data feed has published across every tracked ${city.label} ` +
      "neighborhood. Week-over-week shifts compare days 0-7 to days 8-14; if " +
      "the feed has a publishing lag longer than seven days, the 'recent week' " +
      "period may be sparse. None of this is a prediction — only what has " +
      "already been reported.",
  };
}

export async function getTrendForArea(areaSlug: string, areaLabel: string, opts?: { windowDays?: number }): Promise<TrendResponse> {
  const city = cityForArea(areaSlug);
  const now = Date.now();
  const windowDays = Math.max(1, Math.min(180, opts?.windowDays ?? 30));

  // Pull a generous batch — the adapter cache holds up to 5k rows for the
  // area, which is far more than 30 days for any realistic neighborhood.
  // We filter down to the 30-day window client-side.
  const all = await crimeData.getIncidents(areaSlug, { limit: 5000 }).catch(() => []);
  // Epoch-0 observability — same reasoning as getCitywideTrend above.
  let epoch0Count = 0;
  const validRows = all.filter((i) => {
    const t = +new Date(i.occurredAt);
    if (!Number.isFinite(t) || t <= 86_400_000) { epoch0Count += 1; return false; }
    return true;
  });
  if (all.length > 0 && epoch0Count / all.length > 0.1) {
    console.warn(`[trend-feed] ${city.slug}/${areaSlug}: ${epoch0Count}/${all.length} rows had unparseable/epoch-0 timestamps`);
  }
  // v90p7 — anchor the trend window on the freshest available row
  // (or now, whichever is older). Pre-v90p7 the window was always
  // `now - 30d` which made the trend feed return 0 bullets for any
  // city whose adapter data was 30+ days stale (Sacramento, Phoenix,
  // Boston, NY, Cambridge, KC). Anchoring on max(occurredAt) makes
  // the trend always reflect the freshest available data slice,
  // regardless of upstream publishing lag.
  let anchorMs = now;
  if (validRows.length > 0) {
    let maxT = 0;
    for (const r of validRows) {
      const t = +new Date(r.occurredAt);
      if (t > maxT && t <= now) maxT = t;
    }
    if (maxT > 0) anchorMs = maxT;
  }
  const cutoff = new Date(anchorMs - windowDays * DAY);
  const inWindow = validRows.filter((i) => new Date(i.occurredAt) >= cutoff);
  inWindow.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));

  // Bucket the window into the most recent 7 days vs the 7 days before that,
  // by NIBRS group, so we can emit a week-over-week shift summary.
  // v90p7 — anchored on the same fresh-data point as the cutoff above.
  const recentWeek = new Date(anchorMs - 7 * DAY);
  const priorWeek = new Date(anchorMs - 14 * DAY);
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
      text: `Most reports in ${areaLabel} occur during ${PERIOD_LABEL[tod.dominantPeriod]} — ${tod.dominantPct}% of the past ${windowDays} days landed in that window.`,
    });
  }

  // Recent dispatches — formatted as bullets. Sort DESC by
  // occurredAt first (the underlying area rows arrive in adapter-
  // specific order which isn't guaranteed to be newest-first).
  // v95p18 — cap raised 200 → 5000. Per user directive that every
  // event in the selected interval must be present. Per-area windows
  // are smaller than citywide so 5000 covers any realistic interval.
  const sortedWindow = [...inWindow].sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
  const dispatchBullets: TrendBullet[] = sortedWindow.slice(0, DISPATCH_CAP).map((i) => ({
    kind: "dispatch",
    at: i.occurredAt,
    text: `${ymd(i.occurredAt)} — ${displayOffenseLabel(i.ibrOffenseDescription)}${i.blockLabel ? ` near ${i.blockLabel}` : ""}.`,
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
      `Bullets reflect the most recent ${windowDays} days of incidents the city's police ` +
      "open-data feed has published for this neighborhood. Week-over-week shifts " +
      "compare days 0-7 to days 8-14; if the city's feed has a publishing lag " +
      "longer than seven days, the 'recent week' period may be sparse. None of " +
      "this is a prediction — only what has already been reported.",
  };
}
