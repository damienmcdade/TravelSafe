import { parse as parseCsv } from "csv-parse/sync";
import { env } from "../../../lib/env";
import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";
import { findArea } from "../neighborhoods";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cache: { fetchedAt: number; year: number; rows: Incident[] } | null = null;

function mapCrimeAgainst(value: string | undefined): CrimeCategory {
  const v = (value ?? "").trim().toUpperCase();
  if (v === "PE" || v === "PERSON" || v === "PERSONS") return CrimeCategory.PERSONS;
  if (v === "PR" || v === "PROPERTY") return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
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
  return records.map((r, i) => {
    const lat = Number(r.latitude);
    const lng = Number(r.longitude);
    return {
      id: `${year}-${r.nibrs_uniq ?? r.objectid ?? i}`,
      area: r.neighborhood?.trim() || r.beat?.trim() || "Unknown",
      occurredAt: parseOccurredAt(r),
      nibrsCategory: mapCrimeAgainst(r.crime_against),
      ibrOffenseDescription: r.ibr_offense_description ?? r.ibr_category ?? "Unknown",
      beat: r.beat ?? null,
      blockLabel: r.block_addr ?? undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lng) && lng !== 0 ? lng : undefined,
    };
  });
}

function parseOccurredAt(r: Record<string, string>): string {
  const raw = r.occured_on ?? r.occurred_on ?? "";
  if (raw) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const y = Number(r.year);
  const m = Number(r.month);
  if (y && m) return new Date(Date.UTC(y, m - 1, 15)).toISOString();
  return new Date(0).toISOString();
}

export async function getRows(): Promise<Incident[]> {
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

/// Discover neighborhoods from the cached SDPD CSV. Every unique neighborhood
/// name in the data becomes a KnownArea with a centroid computed from the
/// average of its incidents' lat/lng. This replaces the hardcoded list of 7
/// neighborhoods with the full ~100 SDPD recognizes.
export async function getDiscoveredAreas(): Promise<KnownArea[]> {
  const rows = await getRows().catch(() => [] as Incident[]);
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
    .filter(([, e]) => e.count >= 3) // drop near-empty noise
    .map(([name, e]) => ({
      slug: slugify(name),
      label: name,
      jurisdiction: "San Diego",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const sdpdNibrsAdapter: CrimeDataAdapter = {
  name: "sdpd-nibrs",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRows();
    const known = findArea(area);
    const label = known?.label ?? area;
    const inArea = rows.filter((r) => r.area.toLowerCase() === label.toLowerCase());
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 2000 ? 5 : inArea.length > 1200 ? 4 : inArea.length > 600 ? 3 : inArea.length > 200 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
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
