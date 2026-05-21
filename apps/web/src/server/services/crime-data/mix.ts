import "server-only";
import { crimeData } from ".";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface OffenseSlice {
  offense: string;
  category: "PERSONS" | "PROPERTY" | "SOCIETY";
  count: number;
  lastOccurredAt: string;
}

export interface CrimeMix {
  area: string;
  windowDays: number;
  totalIncidents: number;
  topOffenses: OffenseSlice[];
}

/// Specific-offense breakdown for the last N days. Powers the "Crime mix"
/// card — what kinds of incidents are actually being reported in this area
/// right now, not just the broad NIBRS top-level categories.
export async function getCrimeMix(area: string, windowDays = 30, topN = 12): Promise<CrimeMix> {
  const since = new Date(Date.now() - windowDays * MS_PER_DAY);
  const incidents = await crimeData.getIncidents(area, { limit: 5000, since });
  const counts = new Map<string, { count: number; lastAt: number; category: OffenseSlice["category"] }>();
  for (const i of incidents) {
    const key = i.ibrOffenseDescription || "Unknown";
    const t = +new Date(i.occurredAt);
    const e = counts.get(key) ?? { count: 0, lastAt: 0, category: i.nibrsCategory };
    e.count += 1;
    if (t > e.lastAt) e.lastAt = t;
    counts.set(key, e);
  }
  const topOffenses: OffenseSlice[] = Array.from(counts.entries())
    .map(([offense, e]) => ({ offense, category: e.category, count: e.count, lastOccurredAt: new Date(e.lastAt).toISOString() }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
  return { area, windowDays, totalIncidents: incidents.length, topOffenses };
}
