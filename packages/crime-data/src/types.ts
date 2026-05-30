import type { CrimeCategory } from "./crime-category.js";

// Shared crime-data type contracts. Lives in @travelsafe/crime-data
// so both apps/web (Vercel routes) and apps/api (Railway routes) can
// import the SAME types without duplicating. Previously these types
// lived under apps/web/src/server/services/crime-data/types.ts; the
// route-parity Phase 2 migration extracted them so the Railway API
// can host the same adapters without copy/paste drift.

export interface DataProvenance {
  source: string;
  datasetUrl: string;
  recency: string;
  granularity: "neighborhood" | "beat" | "jurisdiction";
  /** UI must surface this verbatim so we never imply real-time street-level tracking. */
  disclaimer: string;
}

export interface AreaStats {
  area: string;
  crimeRate: number | null;
  violentCrimeRate: number | null;
  propertyCrimeRate: number | null;
  riskLevel: 1 | 2 | 3 | 4 | 5;
  year?: number;
  provenance: DataProvenance;
}

export interface Incident {
  id: string;
  area: string;
  occurredAt: string;
  nibrsCategory: CrimeCategory;
  ibrOffenseDescription: string;
  beat?: string | null;
  blockLabel?: string;
  lat?: number;
  lng?: number;
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

/// Neighborhood / area discovery contract. Adapters' discover() methods
/// return this shape so the citywide aggregator and Crime Map can index
/// them uniformly.
export interface KnownArea {
  slug: string;
  label: string;
  jurisdiction: string;
  centroid: { lat: number; lng: number };
}
