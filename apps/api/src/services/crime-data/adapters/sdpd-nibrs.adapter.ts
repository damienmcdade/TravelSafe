import { parse as parseCsv } from "csv-parse/sync";
import { env } from "../../../env.js";
import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { findArea } from "../neighborhoods.js";

// City of San Diego Open Data — SDPD NIBRS Crime Offenses (quarterly CSV).
// Per-year CSV at: https://seshat.datasd.org/police_nibrs/pd_nibrs_<year>_datasd.csv
// Confirmed columns: occurred_on, ibr_category, ibr_offense_description,
//   crime_against (Person|Property|Society), neighborhood, beat, block_addr.
//
// This adapter caches the latest year in-memory for 6 hours to avoid pounding
// the CSV endpoint. TODO: switch to a scheduled refresh + on-disk cache for
// production scale.

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cache: { fetchedAt: number; year: number; rows: Incident[] } | null = null;

function mapCrimeAgainst(value: string | undefined): CrimeCategory {
  switch ((value ?? "").toLowerCase()) {
    case "person":
    case "persons":
      return CrimeCategory.PERSONS;
    case "property":
      return CrimeCategory.PROPERTY;
    default:
      return CrimeCategory.SOCIETY;
  }
}

const PROVENANCE: DataProvenance = {
  source: "SDPD NIBRS Crime Offenses (City of San Diego Open Data)",
  datasetUrl: "https://data.sandiego.gov/datasets/police-nibrs/",
  recency: "Quarterly refresh; aggregated to neighborhood/beat",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the San Diego Police Department and aggregated to " +
    "neighborhood/beat — not live, not street-level. TravelSafe does not track individuals.",
};

async function fetchYear(year: number): Promise<Incident[]> {
  const url = `${env.SDPD_NIBRS_CSV_BASE}/pd_nibrs_${year}_datasd.csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SDPD NIBRS ${res.status} fetching ${url}`);
  const csv = await res.text();
  const records: Record<string, string>[] = parseCsv(csv, { columns: true, skip_empty_lines: true });
  return records.map((r, i) => ({
    id: `${year}-${r.nibrs_uniq ?? r.objectid ?? i}`,
    area: r.neighborhood?.trim() || r.beat?.trim() || "Unknown",
    occurredAt: r.occurred_on ?? new Date().toISOString(),
    nibrsCategory: mapCrimeAgainst(r.crime_against),
    ibrOffenseDescription: r.ibr_offense_description ?? r.ibr_category ?? "Unknown",
    beat: r.beat ?? null,
    // Block-level address as-published by SDPD (e.g. "1500 BLOCK GARNET AV").
    // Never combined with lat/lng for display.
    blockLabel: r.block_addr ?? undefined,
  }));
}

async function getRows(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  const currentYear = new Date().getFullYear();
  let rows: Incident[] = [];
  for (let y = currentYear; y >= currentYear - 2 && rows.length === 0; y--) {
    try {
      rows = await fetchYear(y);
      cache = { fetchedAt: now, year: y, rows };
      break;
    } catch (err) {
      if (y === currentYear - 2) throw err;
    }
  }
  return rows;
}

export const sdpdNibrsAdapter: CrimeDataAdapter = {
  name: "sdpd-nibrs",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRows();
    const known = findArea(area);
    const label = known?.label ?? area;
    const inArea = rows.filter((r) => r.area.toLowerCase() === label.toLowerCase());
    if (inArea.length === 0) return null;
    // Coarse VOLUME signal over the cached ~annual window (getRows pulls
    // a full calendar year), deliberately NOT a per-capita rate:
    // per-100k rate math and population denominators are owned by the
    // Safety Index (safety-score.ts in @travelsafe/crime-data), and
    // duplicating that normalization here would double-count it.
    // Thresholds are absolute annual counts.
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 2000 ? 5 : inArea.length > 1200 ? 4 : inArea.length > 600 ? 3 : inArea.length > 200 ? 2 : 1;
    return {
      area: label,
      crimeRate: null,
      violentCrimeRate: null,
      propertyCrimeRate: null,
      riskLevel,
      provenance: PROVENANCE,
    };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRows();
    const known = findArea(area);
    const label = known?.label ?? area;
    let filtered = rows.filter((r) => r.area.toLowerCase() === label.toLowerCase());
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },

  async getRecentReports(area: string, opts?: { limit?: number }) {
    return this.getIncidents(area, { limit: opts?.limit ?? 20 });
  },
};
