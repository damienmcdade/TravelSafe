import "server-only";
import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";

// Charlotte — CMPD Incidents on gis.charlottenc.gov ArcGIS MapServer.
// ~14 patrol divisions (University City, Steele Creek, North, Westover,
// Central, Metro, Freedom, Providence, North Tryon, Hickory Grove,
// Independence, South, Eastway, Airport). CMPD also publishes an
// integer NPA (Neighborhood Profile Area) on every row but there are
// ~460 NPAs city-wide — too granular for users to recognize, so we use
// the named patrol division as the area label.
// Doc: https://gis.charlottenc.gov/arcgis/rest/services/CMPD/CMPDIncidents/MapServer/0

const BASE = "https://gis.charlottenc.gov/arcgis/rest/services/CMPD/CMPDIncidents/MapServer/0/query";
const PAGE_SIZE = 2000;
const PAGES = 5;                // 10,000 rows
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface CmpdRow {
  YEAR?: string;
  INCIDENT_REPORT_ID?: string;
  CMPD_PATROL_DIVISION?: string;
  NPA?: number;
  DATE_REPORTED?: number;            // epoch ms
  DATE_INCIDENT_BEGAN?: number;      // epoch ms
  HIGHEST_NIBRS_CODE?: string;
  HIGHEST_NIBRS_DESCRIPTION?: string;
  LATITUDE_PUBLIC?: number;
  LONGITUDE_PUBLIC?: number;
  LOCATION?: string;
}

// CMPD publishes the NIBRS code and a clean description. We map the NIBRS
// description to PERSONS / PROPERTY / SOCIETY via keyword groups. (NIBRS
// itself classifies Robbery as a property crime, which is the FBI's official
// taxonomy — we preserve that here.)
const PERSONS_KEYS = [
  "ASSAULT", "HOMICIDE", "MURDER", "MANSLAUGHTER", "INTIMIDATION",
  "KIDNAPPING", "SEX OFFENSE", "RAPE", "HUMAN TRAFFICKING",
  "MISSING PERSON", "SUDDEN/NATURAL DEATH",
];
const PROPERTY_KEYS = [
  "THEFT", "BURGLARY", "B&E", "LARCENY", "MOTOR VEHICLE",
  "ROBBERY", "ARSON", "VANDALISM", "DAMAGE", "FORGERY",
  "FRAUD", "EMBEZZLEMENT", "COUNTERFEIT", "STOLEN PROPERTY",
  "IDENTITY THEFT", "CREDIT CARD", "FALSE PRETENSES", "SHOPLIFTING",
];

function mapToNibrs(row: CmpdRow): CrimeCategory {
  const t = (row.HIGHEST_NIBRS_DESCRIPTION ?? "").toUpperCase();
  if (PERSONS_KEYS.some((k) => t.includes(k))) return CrimeCategory.PERSONS;
  if (PROPERTY_KEYS.some((k) => t.includes(k))) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "Charlotte-Mecklenburg Police Department CMPD Incidents (City of Charlotte Open Data, ArcGIS MapServer)",
  datasetUrl: "https://data.charlottenc.gov/datasets/CharlotteNC::cmpd-incidents",
  recency: "Refreshed daily by CMPD",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Charlotte-Mecklenburg Police Department and " +
    "aggregated to CMPD's 14 patrol divisions (each ~10-20 sq mi). CMPD does not " +
    "publish suspect / victim demographic columns on this feed.",
};

async function fetchPage(offset: number): Promise<CmpdRow[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "YEAR,INCIDENT_REPORT_ID,CMPD_PATROL_DIVISION,NPA,DATE_REPORTED,DATE_INCIDENT_BEGAN,HIGHEST_NIBRS_CODE,HIGHEST_NIBRS_DESCRIPTION,LATITUDE_PUBLIC,LONGITUDE_PUBLIC,LOCATION");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "DATE_REPORTED DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("f", "json");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "TravelSafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
  });
  if (!res.ok) throw new Error(`Charlotte ArcGIS ${res.status} offset=${offset}`);
  const body = await res.json() as { features?: Array<{ attributes: CmpdRow }> };
  return (body.features ?? []).map((f) => f.attributes);
}

async function fetchCharlotte(): Promise<Incident[]> {
  const pages = await Promise.all(
    Array.from({ length: PAGES }, (_, i) => fetchPage(i * PAGE_SIZE).catch(() => [] as CmpdRow[])),
  );
  const rows = pages.flat();
  return rows.map((r, i) => {
    const div = r.CMPD_PATROL_DIVISION?.trim();
    const area = div && div !== "NA" ? div : "Unknown";
    return {
      id: `clt-${r.INCIDENT_REPORT_ID ?? i}`,
      area,
      occurredAt: r.DATE_INCIDENT_BEGAN ? new Date(r.DATE_INCIDENT_BEGAN).toISOString()
                  : r.DATE_REPORTED ? new Date(r.DATE_REPORTED).toISOString()
                  : new Date(0).toISOString(),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.HIGHEST_NIBRS_DESCRIPTION?.trim() || "Unknown",
      beat: r.NPA != null ? `NPA ${r.NPA}` : null,
      blockLabel: undefined,
      lat: typeof r.LATITUDE_PUBLIC === "number" && r.LATITUDE_PUBLIC !== 0 ? r.LATITUDE_PUBLIC : undefined,
      lng: typeof r.LONGITUDE_PUBLIC === "number" && r.LONGITUDE_PUBLIC !== 0 ? r.LONGITUDE_PUBLIC : undefined,
    };
  });
}

export async function getRowsCharlotte(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchCharlotte();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[clt] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasCharlotte(): Promise<KnownArea[]> {
  const rows = await getRowsCharlotte();
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
      slug: `clt-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Charlotte",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForCharlotteSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("clt-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const charlotteAdapter: CrimeDataAdapter = {
  name: "charlotte-arcgis",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsCharlotte();
    const label = labelForCharlotteSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 800 ? 5 : inArea.length > 500 ? 4 : inArea.length > 300 ? 3 : inArea.length > 100 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsCharlotte();
    const label = labelForCharlotteSlug(area, rows);
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
