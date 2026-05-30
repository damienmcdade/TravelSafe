import { parse as parseCsv } from "csv-parse/sync";
import { env } from "../../../env.js";
import { CrimeCategory } from "../../../generated/prisma/client.js";
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
    "neighborhood/beat — not live, not street-level. CommunitySafe does not track individuals.",
};

// Self-calibrating quintile risk bands, kept self-contained here to match
// the api/sandag adapter's inline approach (the api workspace resolves
// @travelsafe/crime-data against built dist, so the package's risk-bands
// helper isn't importable across the build boundary). Mirrors
// packages/crime-data/src/risk-bands.ts.
const STATIC_SDPD_BANDS = [200, 600, 1200, 2000] as const;

function sdpdRiskLevel(rows: Incident[], count: number): 1 | 2 | 3 | 4 | 5 {
  const byArea = new Map<string, number>();
  for (const r of rows) {
    const a = r.area?.trim().toLowerCase();
    if (!a || a === "unknown") continue;
    byArea.set(a, (byArea.get(a) ?? 0) + 1);
  }
  const dist = [...byArea.values()].filter((n) => n >= 3).sort((a, b) => a - b);
  let bands: readonly number[] = STATIC_SDPD_BANDS;
  if (dist.length >= 5) {
    const q = (p: number) => {
      const pos = (dist.length - 1) * p;
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      return lo === hi ? dist[lo] : dist[lo] + (dist[hi] - dist[lo]) * (pos - lo);
    };
    const cand = [0.2, 0.4, 0.6, 0.8].map(q);
    if (cand.every((b, i) => i === 0 || b > cand[i - 1])) bands = cand;
  }
  let level = 1;
  for (const b of bands) if (count > b) level += 1;
  return Math.min(level, 5) as 1 | 2 | 3 | 4 | 5;
}

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
    // Coarse VOLUME signal over the cached ~annual window, now bucketed by
    // self-calibrating quintile bands over San Diego's own per-neighborhood
    // distribution (case-folded to match the lookup) rather than absolute
    // magic numbers; degrades to the prior thresholds. Still a volume
    // signal, NOT a per-capita rate — per-100k normalization is owned by
    // the Safety Index (safety-score.ts) and is not duplicated here.
    const riskLevel = sdpdRiskLevel(rows, inArea.length);
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
