import { CrimeCategory } from "../../../generated/prisma/client.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { findArea } from "../neighborhoods.js";

// Clearly-labeled sample data. Used when the real adapters are unreachable,
// rate-limited, or when CRIME_DATA_ADAPTER=mock. The provenance string makes
// it loud that this is NOT real data, so the UI can't accidentally present it
// as authoritative.

const PROVENANCE: DataProvenance = {
  source: "CommunitySafe sample data (not a real source)",
  datasetUrl: "about:blank",
  recency: "Static sample; refreshed only on developer rebuild",
  granularity: "neighborhood",
  disclaimer:
    "This is illustrative sample data shipped with CommunitySafe so the UI renders " +
    "without an internet connection. It is NOT real crime data. Configure " +
    "CRIME_DATA_ADAPTER=auto and provide network access to use SANDAG / SDPD feeds.",
};

const SAMPLE: Record<string, Incident[]> = {
  "pacific-beach": [
    { id: "mock-pb-1", area: "Pacific Beach", occurredAt: new Date(Date.now() - 86400000 * 2).toISOString(), nibrsCategory: CrimeCategory.PROPERTY, ibrOffenseDescription: "Theft from vehicle (sample)" },
    { id: "mock-pb-2", area: "Pacific Beach", occurredAt: new Date(Date.now() - 86400000 * 5).toISOString(), nibrsCategory: CrimeCategory.SOCIETY, ibrOffenseDescription: "Disturbing the peace (sample)" },
  ],
  "downtown-sd": [
    { id: "mock-dt-1", area: "Downtown", occurredAt: new Date(Date.now() - 86400000).toISOString(), nibrsCategory: CrimeCategory.PERSONS, ibrOffenseDescription: "Simple assault (sample)" },
  ],
};

export const mockAdapter: CrimeDataAdapter = {
  name: "mock",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const known = findArea(area);
    if (!known) return null;
    return {
      area: known.label,
      crimeRate: 22.4,
      violentCrimeRate: 3.1,
      propertyCrimeRate: 19.3,
      riskLevel: 2,
      year: new Date().getFullYear() - 1,
      provenance: PROVENANCE,
    };
  },
  async getIncidents(area: string, opts) {
    const known = findArea(area);
    return (known ? SAMPLE[known.slug] ?? [] : []).slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area: string, opts) {
    return this.getIncidents(area, opts);
  },
};
