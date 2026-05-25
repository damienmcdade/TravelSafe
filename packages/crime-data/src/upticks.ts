import { crimeData } from "./dispatcher";
import { cityBySlug, CITIES } from "./cities";

/// Recent uptick detector — flags neighborhoods whose 7-day report count
/// jumped meaningfully versus the prior 7 days. Used to surface "what's
/// shifted lately" on the Awareness tab as a tile.
///
/// Filtering:
/// - Skip areas with prior < 3 reports (too noisy to call a multiplier
///   meaningful — a single new incident in a previously-quiet area would
///   register as "5× spike" and waste the tile).
/// - Require multiplier >= 2.0 OR recent >= prior + 8 (the absolute jump
///   so a 4 → 12 increment shows even if it's only 3× ratio).
/// - Sort by multiplier descending; cap at 6 entries.

const DAY = 24 * 60 * 60 * 1000;

export interface UptickEntry {
  area: { slug: string; label: string };
  priorCount: number;
  recentCount: number;
  multiplier: number;
}

export interface UpticksResponse {
  city: { slug: string; label: string };
  windowDays: 7;
  generatedAt: string;
  upticks: UptickEntry[];
}

export async function getCitywideUpticks(citySlug: string): Promise<UpticksResponse> {
  const city = cityBySlug(citySlug) ?? CITIES[0];
  const now = Date.now();
  const recentCutoff = new Date(now - 7 * DAY);
  const priorCutoff = new Date(now - 14 * DAY);

  const areas = await city.discover().catch(() => []);
  const incidentsPerArea = await Promise.all(
    areas.map((a) => crimeData.getIncidents(a.slug, { limit: 5000 }).catch(() => [])),
  );

  const entries: UptickEntry[] = [];
  for (let i = 0; i < areas.length; i++) {
    const area = areas[i];
    const all = incidentsPerArea[i];
    let recent = 0, prior = 0;
    for (const inc of all) {
      const t = new Date(inc.occurredAt);
      if (Number.isNaN(t.getTime())) continue;
      if (t >= recentCutoff) recent += 1;
      else if (t >= priorCutoff) prior += 1;
    }
    if (prior < 3) continue;
    const multiplier = recent / prior;
    const absJump = recent - prior;
    if (multiplier < 2.0 && absJump < 8) continue;
    entries.push({
      area: { slug: area.slug, label: area.label },
      priorCount: prior,
      recentCount: recent,
      multiplier: Math.round(multiplier * 10) / 10,
    });
  }
  entries.sort((a, b) => b.multiplier - a.multiplier);

  return {
    city: { slug: city.slug, label: city.label },
    windowDays: 7,
    generatedAt: new Date(now).toISOString(),
    upticks: entries.slice(0, 6),
  };
}
