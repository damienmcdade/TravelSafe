import { env } from "../../lib/env";
import type { AreaRiskAlert, AreaStats, CrimeDataAdapter, Incident } from "./types";
import { sandagSocrataAdapter } from "./adapters/sandag-socrata";
import { sdpdNibrsAdapter } from "./adapters/sdpd-nibrs";
import { mockAdapter } from "./adapters/mock";

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
    const stats = await tryAdapter(sandagSocrataAdapter, (a) => a.getAreaStats(area));
    if (stats) return stats;
    const fallback = await tryAdapter(sdpdNibrsAdapter, (a) => a.getAreaStats(area));
    return fallback ?? (await mockAdapter.getAreaStats(area));
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }): Promise<Incident[]> {
    const mode = env.CRIME_DATA_ADAPTER;
    if (mode !== "auto") return adapters[mode].getIncidents(area, opts);
    const incidents = await tryAdapter(sdpdNibrsAdapter, (a) => a.getIncidents(area, opts));
    return incidents ?? (await mockAdapter.getIncidents(area, opts));
  },

  async getRecentReports(area: string, opts?: { limit?: number }): Promise<Incident[]> {
    const mode = env.CRIME_DATA_ADAPTER;
    if (mode !== "auto") return adapters[mode].getRecentReports(area, opts);
    const reports = await tryAdapter(sdpdNibrsAdapter, (a) => a.getRecentReports(area, opts));
    return reports ?? (await mockAdapter.getRecentReports(area, opts));
  },

  /// Citywide aggregate for the Awareness tab default view. Sums incidents
  /// across all known SD neighborhoods and emits one alert card per NIBRS
  /// category so users get a city-of-San-Diego overview without picking an area.
  /// Per-area payload now carries a category breakdown so the Crime Map can
  /// surface "what kind of incidents drive this area's score" in its tooltip.
  async getCitywide(): Promise<{
    totalIncidents: number;
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
    const { listKnownAreas } = await import("./neighborhoods");
    const areas = await listKnownAreas();
    const perArea: Awaited<ReturnType<typeof crimeData.getCitywide>>["perArea"] = [];
    const totalByCategory = new Map<string, Incident[]>();
    for (const area of areas) {
      const incidents = await this.getIncidents(area.slug, { limit: 500 });
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
    const sample = perArea[0] ? await this.getAreaStats(perArea[0].slug) : null;
    const alerts: AreaRiskAlert[] = Array.from(totalByCategory.entries()).map(([category, items]) => ({
      area: "City of San Diego",
      category: category as AreaRiskAlert["category"],
      riskLevel: items.length > 800 ? 5 : items.length > 400 ? 4 : items.length > 150 ? 3 : items.length > 40 ? 2 : 1,
      summary: `${items.length} ${category.toLowerCase()} incidents reported across SD neighborhoods in the cached window.`,
      recency: sample?.provenance.recency ?? "see source",
      provenance: sample?.provenance ?? {
        source: "SDPD NIBRS (City of San Diego Open Data)",
        datasetUrl: "https://data.sandiego.gov/datasets/police-nibrs/",
        recency: "Quarterly refresh",
        granularity: "neighborhood",
        disclaimer: "Aggregated from SDPD NIBRS. Not live, not street-level.",
      },
    }));
    const totalIncidents = perArea.reduce((s, a) => s + a.incidentCount, 0);
    return { totalIncidents, alerts, perArea: perArea.sort((a, b) => b.incidentCount - a.incidentCount) };
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
