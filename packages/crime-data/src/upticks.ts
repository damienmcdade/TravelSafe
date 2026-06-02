import { crimeData } from "./dispatcher.js";
import { cityBySlug } from "./cities.js";
import { dedupe } from "./lib/inflight.js";
import { withComputeLimit } from "./lib/compute-limit.js";
import { MS_PER_DAY as DAY } from "./lib/time-constants.js";

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

// v96p2 — DAY now lives in lib/time-constants (re-exported above).

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
  return dedupe(`upticks:${citySlug}`, () => withComputeLimit(citySlug, () => computeCitywideUpticks(citySlug)));
}

async function computeCitywideUpticks(citySlug: string): Promise<UpticksResponse> {
  // v106 — was `?? CITIES[0]`, which silently served San Diego upticks for any
  // unrecognized ?city= slug (data bleed). Reject so the route returns 404.
  const city = cityBySlug(citySlug);
  if (!city) throw new Error(`city_not_supported: ${citySlug}`);
  const now = Date.now();

  const areas = await city.discover().catch(() => []);
  const incidentsPerArea = await Promise.all(
    areas.map((a) => crimeData.getIncidents(a.slug, { limit: 5000 }).catch(() => [])),
  );

  // fix(audit cd-upticks-now-anchor): anchor the recent/prior windows on the
  // freshest published incident, not wall-clock `now`. City feeds lag 7–30 days,
  // so a `now - 7d` "recent" window sat entirely after the newest record and the
  // uptick detector found nothing for almost every city (the Awareness tile never
  // fired). Mirror the trend-feed / safety-score data-latest anchor.
  let maxT = 0;
  for (const arr of incidentsPerArea) {
    for (const inc of arr) {
      const t = +new Date(inc.occurredAt);
      if (Number.isFinite(t) && t <= now && t > maxT) maxT = t;
    }
  }
  const anchorMs = maxT > 0 ? maxT : now;
  const recentCutoff = new Date(anchorMs - 7 * DAY);
  const priorCutoff = new Date(anchorMs - 14 * DAY);

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
