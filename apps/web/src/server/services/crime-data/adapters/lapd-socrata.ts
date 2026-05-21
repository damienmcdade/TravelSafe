import "server-only";
import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";

// City of Los Angeles — LAPD Crime Data from 2020 to Present.
// Socrata dataset 2nrs-mtv8 on data.lacity.org.
// Docs: https://dev.socrata.com/foundry/data.lacity.org/2nrs-mtv8
//
// NIBRS mapping note: LAPD publishes Part I (1) vs Part II (2) instead of
// the three-way NIBRS PE/PR/SO classification. We approximate:
//   * Part I + crm_cd in violent set    -> PERSONS
//   * Part I + crm_cd in property set   -> PROPERTY
//   * Part II                            -> SOCIETY
//
// IMPORTANT: This dataset has victim demographic columns (vict_age,
// vict_sex, vict_descent). TravelSafe's spec forbids displaying or
// storing those. The adapter ONLY reads non-demographic fields. Do not
// add demographic fields to Incident.

const BASE = "https://data.lacity.org/resource/2nrs-mtv8.json";
const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface SodaRow {
  dr_no?: string;
  date_occ?: string;
  area_name?: string;
  crm_cd?: string;
  crm_cd_desc?: string;
  part_1_2?: string;
  rpt_dist_no?: string;
  lat?: string;
  lon?: string;
  location?: string;
}

// LAPD crime codes considered "violent" (Persons) — coarse mapping from
// publicly-documented Part I serious offenses.
const VIOLENT_CRM_CD = new Set([
  "110", "113", "121", "122", "210", "220", "230", "231", "235", "236",
  "250", "251", "761", "762", "812", "813", "860", "910", "920", "921",
]);

function mapToNibrs(row: SodaRow): CrimeCategory {
  const part = (row.part_1_2 ?? "").trim();
  const crm = (row.crm_cd ?? "").trim();
  if (part === "1") {
    if (VIOLENT_CRM_CD.has(crm)) return CrimeCategory.PERSONS;
    return CrimeCategory.PROPERTY;
  }
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "LAPD Crime Data 2020–Present (City of Los Angeles Open Data)",
  datasetUrl: "https://data.lacity.org/Public-Safety/Crime-Data-from-2020-to-Present/2nrs-mtv8",
  recency: "Refreshed weekly by LAPD",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Los Angeles Police Department and aggregated to " +
    "LAPD reporting area / division — not live, not street-level. TravelSafe does not " +
    "track individuals and intentionally ignores victim-demographic columns published " +
    "by LAPD.",
};

async function fetchLapd(): Promise<Incident[]> {
  // Pull the most recent ~10k rows; SODA orders DESC by date_occ.
  const url = new URL(BASE);
  url.searchParams.set("$select", "dr_no,date_occ,area_name,crm_cd,crm_cd_desc,part_1_2,rpt_dist_no,lat,lon");
  url.searchParams.set("$order", "date_occ DESC");
  url.searchParams.set("$limit", "3000");
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "TravelSafe/0.1 (https://github.com/damienmcdade/TravelSafe)",
    },
  });
  if (!res.ok) throw new Error(`LAPD SODA ${res.status} fetching ${url}`);
  const rows = (await res.json()) as SodaRow[];
  return rows.map((r, i) => {
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    return {
      id: `la-${r.dr_no ?? i}`,
      area: r.area_name?.trim() || "Unknown",
      occurredAt: r.date_occ ?? new Date(0).toISOString(),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.crm_cd_desc?.trim() ?? "Unknown",
      beat: r.rpt_dist_no ?? null,
      blockLabel: undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lon) && lon !== 0 ? lon : undefined,
    };
  });
}

export async function getRowsLA(): Promise<Incident[]> {
  const now = Date.now();
  // Only honor cache if it actually has data — caching an empty failed fetch
  // for 6 hours would silently break discovery + UI.
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchLapd();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[lapd] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasLA(): Promise<KnownArea[]> {
  const rows = await getRowsLA();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    const name = r.area?.trim();
    if (!name || name === "Unknown") continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(name) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat; e.lngSum += r.lng; e.count += 1;
    agg.set(name, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 3)
    .map(([name, e]) => ({
      slug: `la-${name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Los Angeles",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export const lapdAdapter: CrimeDataAdapter = {
  name: "lapd-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsLA();
    const label = labelForLaSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area.toLowerCase() === label.toLowerCase());
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 2000 ? 5 : inArea.length > 1200 ? 4 : inArea.length > 600 ? 3 : inArea.length > 200 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsLA();
    const label = labelForLaSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area.toLowerCase() === label.toLowerCase());
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },

  async getRecentReports(area: string, opts?: { limit?: number }) {
    return this.getIncidents(area, { limit: opts?.limit ?? 20 });
  },
};

function labelForLaSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  // Strip "la-" prefix if present
  const want = s.startsWith("la-") ? s.slice(3) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  // direct label match
  for (const r of rows) {
    if (r.area.toLowerCase() === s) return r.area;
  }
  return null;
}
