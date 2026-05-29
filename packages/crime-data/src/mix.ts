import { crimeData } from "./dispatcher.js";
import { cityBySlug } from "./cities.js";
import { dedupe } from "./lib/inflight.js";
import { displayOffenseLabel } from "./lib/offense-display-label.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Per-area cap for citywide aggregation. The single-area path pulls up to
// 5,000 incidents; doing the same for every area of a city like Detroit
// (199 areas) would blow memory. 1,000 still gives a representative
// offense distribution for the top-12 ranking without OOM risk.
const CITYWIDE_PER_AREA_LIMIT = 1000;

export interface OffenseSlice {
  offense: string;
  category: "PERSONS" | "PROPERTY" | "SOCIETY";
  count: number;
  lastOccurredAt: string;
}

export interface CrimeMix {
  area: string;
  /** Number of days the response covers, derived from min(latest) → max(latest) of the matched incidents. */
  windowDays: number;
  /** Date of the most recent incident reflected in the response. */
  asOf: string | null;
  totalIncidents: number;
  topOffenses: OffenseSlice[];
}

/// Specific-offense breakdown of the area's most-recent incidents. Originally
/// this used a strict "last 30 days" filter, but several cities publish their
/// open-data feeds with substantial lag (LAPD shows reports from late 2024 in
/// mid-2026; SDPD NIBRS refreshes quarterly). A 30-day window threw away
/// every row, leaving the graph empty.
///
/// New behavior: pull the most recent up-to-5,000 incidents the adapter has
/// for the area without a date filter, then *report* the actual span those
/// incidents cover so the UI can show "last 87 days" or "as of Dec 2024"
/// honestly instead of pretending we have current data.
export async function getCrimeMix(area: string, _windowDays?: number, topN = 12): Promise<CrimeMix> {
  void _windowDays; // legacy param, no longer used — kept so existing callers don't break
  const incidents = await crimeData.getIncidents(area, { limit: 5000 });
  const counts = new Map<string, { count: number; lastAt: number; category: OffenseSlice["category"] }>();
  let earliest = Infinity;
  let latest = 0;
  for (const i of incidents) {
    // v96p2 — was the raw upstream string ("ALL OTHER OFFENSES").
    // displayOffenseLabel maps every observed variant to the same
    // user-facing form the chart legend uses, so the API and AI
    // summary surfaces don't fall out of sync with the UI label.
    const key = displayOffenseLabel(i.ibrOffenseDescription || "Unknown");
    const t = +new Date(i.occurredAt);
    if (Number.isFinite(t) && t > 0) {
      if (t < earliest) earliest = t;
      if (t > latest) latest = t;
    }
    const e = counts.get(key) ?? { count: 0, lastAt: 0, category: i.nibrsCategory };
    e.count += 1;
    if (t > e.lastAt) e.lastAt = t;
    counts.set(key, e);
  }
  const topOffenses: OffenseSlice[] = Array.from(counts.entries())
    .map(([offense, e]) => ({ offense, category: e.category, count: e.count, lastOccurredAt: new Date(e.lastAt).toISOString() }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
  const windowDays = (latest > 0 && earliest < Infinity)
    ? Math.max(1, Math.round((latest - earliest) / MS_PER_DAY))
    : 0;
  return {
    area,
    windowDays,
    asOf: latest > 0 ? new Date(latest).toISOString() : null,
    totalIncidents: incidents.length,
    topOffenses,
  };
}

/// Citywide variant of getCrimeMix. Aggregates the offense breakdown
/// across every neighborhood of a city, capped per-area to keep memory
/// bounded. Replaces the previous "pass jurisdiction=<citySlug>" path,
/// which incorrectly tried to fetch incidents as if the city slug were
/// an area slug and silently returned zero — same class of bug as the
/// Safety Index all-100 regression. The response shape matches the
/// per-area CrimeMix so the UI renders with one branch.
export async function getCitywideCrimeMix(citySlug: string, topN = 12): Promise<CrimeMix> {
  return dedupe(`mix:${citySlug}:${topN}`, () => computeCitywideCrimeMix(citySlug, topN));
}

async function computeCitywideCrimeMix(citySlug: string, topN: number): Promise<CrimeMix> {
  const city = cityBySlug(citySlug);
  if (!city) return { area: citySlug, windowDays: 0, asOf: null, totalIncidents: 0, topOffenses: [] };
  const areas = await city.discover().catch(() => []);
  // Soft-fail per area — one slow/broken adapter call shouldn't drop the
  // whole citywide aggregate. Same posture as crimeData.getCitywide.
  const perArea = await Promise.all(
    areas.map((a) => crimeData.getIncidents(a.slug, { limit: CITYWIDE_PER_AREA_LIMIT }).catch(() => [])),
  );
  const counts = new Map<string, { count: number; lastAt: number; category: OffenseSlice["category"] }>();
  let earliest = Infinity;
  let latest = 0;
  let total = 0;
  for (const incidents of perArea) {
    total += incidents.length;
    for (const i of incidents) {
      // v96p2 — was the raw upstream string ("ALL OTHER OFFENSES").
    // displayOffenseLabel maps every observed variant to the same
    // user-facing form the chart legend uses, so the API and AI
    // summary surfaces don't fall out of sync with the UI label.
    const key = displayOffenseLabel(i.ibrOffenseDescription || "Unknown");
      const t = +new Date(i.occurredAt);
      if (Number.isFinite(t) && t > 0) {
        if (t < earliest) earliest = t;
        if (t > latest) latest = t;
      }
      const e = counts.get(key) ?? { count: 0, lastAt: 0, category: i.nibrsCategory };
      e.count += 1;
      if (t > e.lastAt) e.lastAt = t;
      counts.set(key, e);
    }
  }
  const topOffenses: OffenseSlice[] = Array.from(counts.entries())
    .map(([offense, e]) => ({ offense, category: e.category, count: e.count, lastOccurredAt: new Date(e.lastAt).toISOString() }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
  const windowDays = (latest > 0 && earliest < Infinity)
    ? Math.max(1, Math.round((latest - earliest) / MS_PER_DAY))
    : 0;
  return {
    area: `${city.label} (citywide)`,
    windowDays,
    asOf: latest > 0 ? new Date(latest).toISOString() : null,
    totalIncidents: total,
    topOffenses,
  };
}
