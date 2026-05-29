import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import type { KnownArea } from "../neighborhoods.js";
import { fetchSocrata, socrataDate } from "../lib/http.js";

// Cambridge MA — Cambridge Police Crime Reports (xuad-73uj on
// data.cambridgema.gov). The crime data dataset publishes a native
// `neighborhood` text field — but Cambridge's *polygon* dataset (k3pi-9823)
// uses slightly different formal names for four of the thirteen
// neighborhoods. We normalize on intake so the map polygon click and the
// neighborhood card always join.

const BASE = "https://data.cambridgema.gov/resource/xuad-73uj.json";
const ROW_LIMIT = 5_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface CamRow {
  file_number?: string;
  date_of_report?: string;
  crime_date_time?: string;
  crime?: string;
  reporting_area?: string;
  neighborhood?: string;
  location?: string;
  reporting_area_lat?: string;
  reporting_area_lon?: string;
}

// Crime-dataset label → polygon-dataset label.  Cambridge's informal/legacy
// crime labels do not match the formal CDD neighborhood names on four rows;
// rewrite them so map joins line up.
const NEIGHBORHOOD_ALIAS: Record<string, string> = {
  "Peabody":           "Neighborhood Nine",
  "Inman/Harrington":  "Wellington-Harrington",
  "Highlands":         "Cambridge Highlands",
  "MIT":               "Area 2/MIT",
};

function normalizeNeighborhood(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  const trimmed = raw.trim();
  return NEIGHBORHOOD_ALIAS[trimmed] ?? trimmed;
}

const PERSONS_KEYS = [
  "ASSAULT", "ROBBERY", "HOMICIDE", "MURDER", "RAPE", "SEX OFFENSE",
  "KIDNAPPING", "THREATS", "HARASSMENT", "DOMESTIC", "STREET ROBBERY",
];
const PROPERTY_KEYS = [
  "LARCENY", "HOUSEBREAK", "AUTO THEFT", "BURGLARY", "MAL. DEST",
  "VANDALISM", "ARSON", "FORGERY", "FRAUD", "FLIM FLAM",
  "SHOPLIFTING", "COMMERCIAL BREAK", "ATTEMPTED STEALING",
];

function mapToNibrs(row: CamRow): CrimeCategory {
  const t = (row.crime ?? "").toUpperCase();
  if (PERSONS_KEYS.some((k) => t.includes(k))) return CrimeCategory.PERSONS;
  if (PROPERTY_KEYS.some((k) => t.includes(k))) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "Cambridge Police Crime Reports (City of Cambridge Open Data)",
  datasetUrl: "https://data.cambridgema.gov/Public-Safety/Crime-Reports/xuad-73uj",
  recency: "Refreshed weekly; coordinates aggregated to reporting-area centroid by CPD",
  granularity: "neighborhood",
  disclaimer:
    "Reports are aggregated to the reporting-area centroid by CPD — they do not " +
    "point to a specific address. NIBRS category is inferred from CPD's free-text " +
    "crime label and may be imperfect for unusual offenses.",
};

function safeIso(raw: string | null | undefined): string {
  if (!raw) return new Date(0).toISOString();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

async function fetchCambridge(): Promise<Incident[]> {
  // v96 — migrated to fetchSocrata helper.
  // v96p2 — defensive 180-d cutoff matching the other Socrata adapters.
  const cutoff = socrataDate(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const rows = await fetchSocrata<CamRow>("Cambridge Socrata", {
    url: BASE,
    select: "file_number,date_of_report,crime,reporting_area,neighborhood,reporting_area_lat,reporting_area_lon,location",
    where: `neighborhood IS NOT NULL AND date_of_report >= '${cutoff}'`,
    order: "date_of_report DESC",
    limit: ROW_LIMIT,
  });
  return rows.map((r, i) => {
    const lat = Number(r.reporting_area_lat);
    const lng = Number(r.reporting_area_lon);
    return {
      id: `cam-${r.file_number ?? i}`,
      area: normalizeNeighborhood(r.neighborhood),
      occurredAt: safeIso(r.date_of_report),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.crime?.trim() || "Unknown",
      beat: r.reporting_area ?? null,
      blockLabel: undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lng) && lng !== 0 ? lng : undefined,
    };
  });
}

export async function getRowsCambridge(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchCambridge();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[cam] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasCambridge(): Promise<KnownArea[]> {
  const rows = await getRowsCambridge();
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
      slug: `cam-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Cambridge",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForCambridgeSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("cam-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const cambridgeAdapter: CrimeDataAdapter = {
  name: "cambridge-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsCambridge();
    const label = labelForCambridgeSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 300 ? 5 : inArea.length > 160 ? 4 : inArea.length > 80 ? 3 : inArea.length > 30 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsCambridge();
    const label = labelForCambridgeSlug(area, rows);
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
