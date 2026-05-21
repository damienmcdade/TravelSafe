import { env } from "../../lib/env";
import type { AreaRiskAlert, AreaStats, CrimeDataAdapter, Incident } from "./types";
import { sandagSocrataAdapter } from "./adapters/sandag-socrata";
import { sdpdNibrsAdapter } from "./adapters/sdpd-nibrs";
import { mockAdapter } from "./adapters/mock";
import { cityForArea, CITIES } from "./cities";

export * from "./types";

const adapters: Record<string, CrimeDataAdapter> = {
  sandag: sandagSocrataAdapter,
  sdpd: sdpdNibrsAdapter,
  mock: mockAdapter,
};

async function tryAdapter<T>(adapter: CrimeDataAdapter, run: (a: CrimeDataAdapter) => Promise<T>): Promise<T | null> {
  try {
    return await run(adapter);
  } catch (err) {
    console.warn(`[crime-data] adapter ${adapter.name} failed:`, (err as Error).message);
    return null;
  }
}

/// Picks adapter(s) per CRIME_DATA_ADAPTER. In "auto" mode, real adapters are
/// tried in order and fall through to the mock if both fail — guaranteeing
/// the UI always renders something.
export const crimeData = {
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const mode = env.CRIME_DATA_ADAPTER;
    if (mode !== "auto") return adapters[mode].getAreaStats(area);
    // Route by city: LA-prefixed slugs hit LAPD, others hit SDPD primary.
    const cityAdapter = cityForArea(area).adapter;
    const stats = await tryAdapter(cityAdapter, (a) => a.getAreaStats(area));
    if (stats) return stats;
    // SANDAG jurisdiction-level stats still answer for city-of-SD overview.
    if (cityAdapter === sdpdNibrsAdapter) {
      const sandag = await tryAdapter(sandagSocrataAdapter, (a) => a.getAreaStats(area));
      if (sandag) return sandag;
    }
    return mockAdapter.getAreaStats(area);
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }): Promise<Incident[]> {
    const mode = env.CRIME_DATA_ADAPTER;
    if (mode !== "auto") return adapters[mode].getIncidents(area, opts);
    const cityAdapter = cityForArea(area).adapter;
    const incidents = await tryAdapter(cityAdapter, (a) => a.getIncidents(area, opts));
    return incidents ?? (await mockAdapter.getIncidents(area, opts));
  },

  async getRecentReports(area: string, opts?: { limit?: number }): Promise<Incident[]> {
    const mode = env.CRIME_DATA_ADAPTER;
    if (mode !== "auto") return adapters[mode].getRecentReports(area, opts);
    const cityAdapter = cityForArea(area).adapter;
    const reports = await tryAdapter(cityAdapter, (a) => a.getRecentReports(area, opts));
    return reports ?? (await mockAdapter.getRecentReports(area, opts));
  },

  /// Citywide aggregate for the Awareness tab default view. Sums incidents
  /// across all known SD neighborhoods and emits one alert card per NIBRS
  /// category so users get a city-of-San-Diego overview without picking an area.
  /// Per-area payload now carries a category breakdown so the Crime Map can
  /// surface "what kind of incidents drive this area's score" in its tooltip.
  async getCitywide(citySlug: string = "san-diego", opts: { offense?: string } = {}): Promise<{
    city: string;
    totalIncidents: number;
    appliedOffense: string | null;
    topOffenses: Array<{ offense: string; count: number }>;
    alerts: AreaRiskAlert[];
    perArea: Array<{
      slug: string;
      label: string;
      incidentCount: number;
      riskLevel: 1 | 2 | 3 | 4 | 5;
      byCategory: { PERSONS: number; PROPERTY: number; SOCIETY: number };
      dominantCategory: "PERSONS" | "PROPERTY" | "SOCIETY" | null;
    }>;
  }> {
    const { cityBySlug } = await import("./cities");
    const city = cityBySlug(citySlug) ?? CITIES[0];
    const areas = await city.discover().catch(() => [] as Awaited<ReturnType<typeof city.discover>>);
    const offenseFilter = opts.offense?.toLowerCase().trim();
    const perArea: Awaited<ReturnType<typeof crimeData.getCitywide>>["perArea"] = [];
    const totalByCategory = new Map<string, Incident[]>();
    const offenseCounts = new Map<string, number>();
    for (const area of areas) {
      const incidentsAll = await this.getIncidents(area.slug, { limit: 500 });
      // When the caller filters by a specific offense, only count incidents
      // matching that offense for this area's color/intensity — but still
      // accumulate the full top-offenses list across the city so the UI's
      // dropdown can show all options.
      for (const i of incidentsAll) {
        const off = i.ibrOffenseDescription;
        offenseCounts.set(off, (offenseCounts.get(off) ?? 0) + 1);
      }
      const incidents = offenseFilter
        ? incidentsAll.filter((i) => i.ibrOffenseDescription.toLowerCase() === offenseFilter)
        : incidentsAll;
      const byCategory = { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 };
      for (const i of incidents) {
        const k = i.nibrsCategory as keyof typeof byCategory;
        if (k in byCategory) byCategory[k] += 1;
        const arr = totalByCategory.get(i.nibrsCategory) ?? [];
        arr.push(i);
        totalByCategory.set(i.nibrsCategory, arr);
      }
      const dominantCategory = (Object.entries(byCategory) as Array<["PERSONS" | "PROPERTY" | "SOCIETY", number]>)
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const riskLevel = (incidents.length > 400 ? 5 : incidents.length > 200 ? 4 : incidents.length > 80 ? 3 : incidents.length > 25 ? 2 : 1) as 1 | 2 | 3 | 4 | 5;
      perArea.push({ slug: area.slug, label: area.label, incidentCount: incidents.length, riskLevel, byCategory, dominantCategory: incidents.length > 0 ? dominantCategory : null });
    }
    const topOffenses = Array.from(offenseCounts.entries())
      .map(([offense, count]) => ({ offense, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);
    const sample = perArea[0] ? await this.getAreaStats(perArea[0].slug) : null;
    const alerts: AreaRiskAlert[] = Array.from(totalByCategory.entries()).map(([category, items]) => ({
      area: `City of ${city.label}`,
      category: category as AreaRiskAlert["category"],
      riskLevel: items.length > 800 ? 5 : items.length > 400 ? 4 : items.length > 150 ? 3 : items.length > 40 ? 2 : 1,
      summary: `${items.length} ${category.toLowerCase()} incidents reported across ${city.label} neighborhoods in the cached window.`,
      recency: sample?.provenance.recency ?? "see source",
      provenance: sample?.provenance ?? {
        source: `${city.label} public crime data`,
        datasetUrl: "about:blank",
        recency: "see adapter",
        granularity: "neighborhood",
        disclaimer: `Aggregated for ${city.label}. Not live, not street-level.`,
      },
    }));
    const totalIncidents = perArea.reduce((s, a) => s + a.incidentCount, 0);
    return {
      city: city.label,
      totalIncidents,
      appliedOffense: offenseFilter ?? null,
      topOffenses,
      alerts,
      perArea: perArea.sort((a, b) => b.incidentCount - a.incidentCount),
    };
  },

  /// Derive area-level risk alert cards for the Threat Detection tab from
  /// recent incidents. Returns one alert per NIBRS category present, with a
  /// risk level based on incident count in the window.
  async getAreaAlerts(area: string, opts?: { limit?: number }): Promise<AreaRiskAlert[]> {
    const incidents = await this.getIncidents(area, { limit: opts?.limit ?? 100 });
    if (incidents.length === 0) return [];
    const byCategory = new Map<string, Incident[]>();
    for (const i of incidents) {
      const arr = byCategory.get(i.nibrsCategory) ?? [];
      arr.push(i);
      byCategory.set(i.nibrsCategory, arr);
    }
    const provenance = (incidents[0] as Incident & { provenance?: unknown }).provenance;
    const stats = await this.getAreaStats(area);
    return Array.from(byCategory.entries()).map(([category, items]) => ({
      area,
      category: category as AreaRiskAlert["category"],
      riskLevel: items.length > 60 ? 5 : items.length > 30 ? 4 : items.length > 10 ? 3 : items.length > 3 ? 2 : 1,
      summary: `${items.length} ${category.toLowerCase()} incidents reported in the cached window.`,
      recency: stats?.provenance.recency ?? "see source",
      provenance: stats?.provenance ?? (provenance as AreaRiskAlert["provenance"]),
    }));
  },
};
