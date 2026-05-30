import type { CrimeCategory } from "../../generated/prisma/client.js";

export interface DataProvenance {
  source: string;          // human-readable source name
  datasetUrl: string;      // canonical link to the dataset
  recency: string;         // e.g. "Yearly through 2022", "Quarterly, last refresh 2026-04-01"
  granularity: "neighborhood" | "beat" | "jurisdiction";
  /** UI must surface this verbatim so we never imply real-time street-level tracking. */
  disclaimer: string;
}

export interface AreaStats {
  area: string;                  // jurisdiction or neighborhood label
  crimeRate: number | null;      // per 1,000 (or null if unknown)
  violentCrimeRate: number | null;
  propertyCrimeRate: number | null;
  riskLevel: 1 | 2 | 3 | 4 | 5;  // derived bucket for UI cards
  year?: number;
  provenance: DataProvenance;
}

export interface Incident {
  id: string;
  area: string;
  occurredAt: string;            // ISO date (day-level — incident data is aggregated)
  nibrsCategory: CrimeCategory;
  ibrOffenseDescription: string;
  beat?: string | null;
  // No exact lat/lng on display. The adapter may carry it but the route
  // returns the value as-published (block-level), with a "block_addr"-style label.
  blockLabel?: string;
}

export interface AreaRiskAlert {
  area: string;
  category: CrimeCategory;
  riskLevel: 1 | 2 | 3 | 4 | 5;
  summary: string;
  recency: string;
  provenance: DataProvenance;
}

export interface CrimeDataAdapter {
  name: string;
  getAreaStats(area: string): Promise<AreaStats | null>;
  getIncidents(area: string, opts?: { limit?: number; since?: Date }): Promise<Incident[]>;
  getRecentReports(area: string, opts?: { limit?: number }): Promise<Incident[]>;
}
