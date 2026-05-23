import "server-only";
import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";

// City of New York — NYPD Complaint Data Current (Year-To-Date).
// Socrata dataset 5uac-w243 on data.cityofnewyork.us. We use the YTD feed
// rather than the 2006-present historical feed (qgea-i56i) so users see
// fresh data; the historical feed is decades-large but updated yearly.
// Doc: https://dev.socrata.com/foundry/data.cityofnewyork.us/5uac-w243

const BASE = "https://data.cityofnewyork.us/resource/5uac-w243.json";
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface SodaRow {
  cmplnt_num?: string;
  cmplnt_fr_dt?: string;     // ISO date, time portion always 00:00:00.000
  cmplnt_fr_tm?: string;     // HH:MM:SS — concatenate with cmplnt_fr_dt
  boro_nm?: string;          // MANHATTAN | BRONX | BROOKLYN | QUEENS | STATEN ISLAND
  addr_pct_cd?: string;      // precinct number, 1..123 (gaps)
  ofns_desc?: string;
  pd_desc?: string;
  law_cat_cd?: string;       // FELONY | MISDEMEANOR | VIOLATION
  latitude?: string;
  longitude?: string;
}

// NYPD doesn't tag complaints with a NIBRS category. We infer from the
// offense description; the substring matches below cover the bulk of the
// distinct ofns_desc values that appear in the dataset.
const PERSONS_KEYWORDS = [
  "ASSAULT", "ROBBERY", "MURDER", "HOMICIDE", "SEX", "RAPE",
  "KIDNAPPING", "HARRASSMENT", "STRANGULATION", "MENACING",
  "OFFENSES AGAINST THE PERSON",
];
const PROPERTY_KEYWORDS = [
  "LARCENY", "BURGLARY", "THEFT", "STOLEN", "ARSON",
  "VEHICLE", "FRAUD", "FORGERY", "CRIMINAL MISCHIEF",
  "TRESPASS", "PROPERTY",
];
function mapToNibrs(row: SodaRow): CrimeCategory {
  const desc = (row.ofns_desc ?? "").toUpperCase();
  if (PERSONS_KEYWORDS.some((k) => desc.includes(k))) return CrimeCategory.PERSONS;
  if (PROPERTY_KEYWORDS.some((k) => desc.includes(k))) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "NYPD Complaint Data Current Year-To-Date (NYC Open Data)",
  datasetUrl: "https://data.cityofnewyork.us/Public-Safety/NYPD-Complaint-Data-Current-Year-To-Date-/5uac-w243",
  recency: "Refreshed weekly by NYPD; current calendar year only",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the New York City Police Department and " +
    "aggregated to NYPD precinct — not live, not street-level. TravelSafe " +
    "does not track individuals and intentionally ignores victim-demographic " +
    "columns published by NYPD.",
};

function ordinal(n: number): string {
  const j = n % 10, k = n % 100;
  if (k >= 10 && k <= 20) return `${n}th`;
  return `${n}${j === 1 ? "st" : j === 2 ? "nd" : j === 3 ? "rd" : "th"}`;
}

/// "47" → "47th Precinct". Matches the polygon file's `properties.name`.
function precinctName(p: string | undefined): string | null {
  if (!p) return null;
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${ordinal(n)} Precinct`;
}

async function fetchNypd(): Promise<Incident[]> {
  const url = new URL(BASE);
  url.searchParams.set("$select", "cmplnt_num,cmplnt_fr_dt,cmplnt_fr_tm,boro_nm,addr_pct_cd,ofns_desc,pd_desc,law_cat_cd,latitude,longitude");
  url.searchParams.set("$order", "cmplnt_fr_dt DESC");
  url.searchParams.set("$limit", "50000");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "TravelSafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
  });
  if (!res.ok) throw new Error(`NYPD SODA ${res.status} ${url}`);
  const rows = (await res.json()) as SodaRow[];
  // Drop rows with no parseable date BEFORE constructing Incidents. The
  // earlier `new Date(0).toISOString()` fallback survived row mapping
  // but was filtered out by the citywide aggregator's `t > 0` invariant,
  // collapsing windowDays → 0 → 0/100k → misleading "below national"
  // score. Same fix as Charlotte/DC/MPLS/KC/Cincinnati earlier.
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const datePart = (r.cmplnt_fr_dt ?? "").slice(0, 10); // YYYY-MM-DD
    if (!datePart) continue;
    const timePart = r.cmplnt_fr_tm ?? "00:00:00";
    const d = new Date(`${datePart}T${timePart}`);
    if (Number.isNaN(d.getTime()) || d.getTime() <= 0) continue;
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    const area = precinctName(r.addr_pct_cd) ?? "Unknown";
    out.push({
      id: `ny-${r.cmplnt_num ?? i}`,
      area,
      occurredAt: d.toISOString(),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.pd_desc?.trim() || r.ofns_desc?.trim() || "Unknown",
      beat: null,
      blockLabel: undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lon) && lon !== 0 ? lon : undefined,
    });
  }
  return out;
}

export async function getRowsNYC(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchNypd();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[nypd] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasNYC(): Promise<KnownArea[]> {
  const rows = await getRowsNYC();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat; e.lngSum += r.lng; e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 3)
    .map(([name, e]) => ({
      slug: `ny-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "New York City",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => {
      // Sort by precinct number rather than alpha so the wheel reads like
      // "1st Precinct, 5th Precinct, ..." not "10th, 100th, 1st".
      const na = parseInt(a.label, 10) || 999;
      const nb = parseInt(b.label, 10) || 999;
      return na - nb;
    });
}

function labelForNYCSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("ny-") ? s.slice(3) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const nypdAdapter: CrimeDataAdapter = {
  name: "nypd-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsNYC();
    const label = labelForNYCSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 2000 ? 5 : inArea.length > 1200 ? 4 : inArea.length > 600 ? 3 : inArea.length > 200 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsNYC();
    const label = labelForNYCSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },

  async getRecentReports(area: string, opts?: { limit?: number }) {
    return this.getIncidents(area, { limit: opts?.limit ?? 20 });
  },
};
