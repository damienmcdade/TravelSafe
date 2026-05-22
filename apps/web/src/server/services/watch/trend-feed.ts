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
  source: { label: string; url: string };
  disclaimer: string;
}

function ymd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
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
  for (const a of areas) {
    const rows = await crimeData.getIncidents(a.slug, { limit: 5000 }).catch(() => []);
    for (const r of rows) {
      if (new Date(r.occurredAt) >= cutoff) {
        inWindow.push({
          occurredAt: r.occurredAt,
          nibrsCategory: r.nibrsCategory as "PERSONS" | "PROPERTY" | "SOCIETY",
          ibrOffenseDescription: r.ibrOffenseDescription,
          blockLabel: r.blockLabel,
          area: a.label,
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
