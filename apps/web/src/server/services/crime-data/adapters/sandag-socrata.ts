import { env } from "../../../lib/env";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import { findArea } from "../neighborhoods";

// SANDAG Crime Data on the San Diego County Open Data Portal (Socrata).
// Dataset: yearly crime rates per jurisdiction (San Diego, Chula Vista, La Mesa,
// El Cajon, etc.). Confirmed schema:
//   year:number, jurisdiction:text, crime_rate:number,
//   violent_crime_rate:number, property_crime_rate:number
//
// This adapter is ideal for getAreaStats() at JURISDICTION granularity.
// getIncidents / getRecentReports return [] here — the SDPD NIBRS adapter
// covers incident-level data. TODO: expand once SANDAG publishes a
// neighborhood-level incident dataset on the Socrata portal.

interface SodaRow {
  year?: string;
  jurisdiction?: string;
  crime_rate?: string;
  violent_crime_rate?: string;
  property_crime_rate?: string;
}

const PROVENANCE: DataProvenance = {
  source: "SANDAG Crime Data (San Diego County Open Data Portal)",
  datasetUrl: `https://data.sandiegocounty.gov/Safety/SANDAG-Crime-Data/${env.SANDAG_CRIME_RATES_RESOURCE_ID}`,
  recency: "Annual report, latest year per record",
  granularity: "jurisdiction",
  disclaimer:
    "Crime-rate figures are jurisdiction-level annual aggregates published by SANDAG. " +
    "TravelSafe does not track individuals or street-level incidents.",
};

function bucketRisk(rate: number | null): 1 | 2 | 3 | 4 | 5 {
  // crime_rate in the dataset is per 1,000 population. Bucket boundaries are
  // a starting heuristic — TODO: calibrate against San Diego regional bands.
  if (rate == null) return 3;
  if (rate < 15) return 1;
  if (rate < 25) return 2;
  if (rate < 35) return 3;
  if (rate < 50) return 4;
  return 5;
}

async function sodaGet(query: Record<string, string>): Promise<SodaRow[]> {
  const url = new URL(`${env.SANDAG_SOCRATA_BASE}/resource/${env.SANDAG_CRIME_RATES_RESOURCE_ID}.json`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (env.SANDAG_SOCRATA_APP_TOKEN) headers["X-App-Token"] = env.SANDAG_SOCRATA_APP_TOKEN;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`SANDAG SODA ${res.status}: ${await res.text()}`);
  return (await res.json()) as SodaRow[];
}

export const sandagSocrataAdapter: CrimeDataAdapter = {
  name: "sandag-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const known = findArea(area);
    const jurisdiction = known?.jurisdiction ?? area;

    const rows = await sodaGet({
      $where: `jurisdiction='${jurisdiction.replace(/'/g, "''")}'`,
      $order: "year DESC",
      $limit: "1",
    });
    if (rows.length === 0) return null;
    const r = rows[0];
    const crimeRate = r.crime_rate != null ? Number(r.crime_rate) : null;
    return {
      area: known?.label ?? jurisdiction,
      crimeRate,
      violentCrimeRate: r.violent_crime_rate != null ? Number(r.violent_crime_rate) : null,
      propertyCrimeRate: r.property_crime_rate != null ? Number(r.property_crime_rate) : null,
      riskLevel: bucketRisk(crimeRate),
      year: r.year != null ? Number(r.year) : undefined,
      provenance: PROVENANCE,
    };
  },

  async getIncidents(): Promise<Incident[]> {
    return [];
  },

  async getRecentReports(): Promise<Incident[]> {
    return [];
  },
};
