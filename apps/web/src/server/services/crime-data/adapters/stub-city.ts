import "server-only";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";

// Stub adapter for cities where we don't have a confirmed public crime API
// yet. Returns empty data + a clearly-labeled provenance so the UI surfaces
// "no data — feed not wired" instead of pretending to know anything.
//
// To replace with a real adapter:
//   1. Find the city's public crime data endpoint (Socrata, ArcGIS, REST).
//   2. Implement getRows + getDiscovered + adapter following lapd-socrata.ts.
//   3. Replace the stub entry in cities.ts.

export function createCityStub(cityLabel: string, cityCenter: { lat: number; lng: number }) {
  const PROVENANCE: DataProvenance = {
    source: `${cityLabel} — no public crime feed wired yet`,
    datasetUrl: "about:blank",
    recency: "n/a",
    granularity: "neighborhood",
    disclaimer:
      `${cityLabel}'s public crime API has not yet been integrated. The city is ` +
      `registered with TravelSafe so search and routing work, but no incident data ` +
      `is shown. If you know of an open ${cityLabel} police crime feed, please open ` +
      `a GitHub issue.`,
  };

  const adapter: CrimeDataAdapter = {
    name: `stub-${cityLabel.toLowerCase().replace(/\s+/g, "-")}`,
    async getAreaStats(): Promise<AreaStats | null> {
      return { area: cityLabel, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel: 1, provenance: PROVENANCE };
    },
    async getIncidents(): Promise<Incident[]> { return []; },
    async getRecentReports(): Promise<Incident[]> { return []; },
  };

  const discover = async (): Promise<KnownArea[]> => {
    // Expose a single placeholder area so the city appears searchable +
    // mappable, with a centroid at the city center.
    return [{
      slug: `${cityLabel.toLowerCase().replace(/\s+/g, "-")}-city`,
      label: `${cityLabel} (citywide)`,
      jurisdiction: cityLabel,
      centroid: cityCenter,
    }];
  };

  return { adapter, discover, provenance: PROVENANCE };
}
