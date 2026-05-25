import "server-only";
import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";
import { titleCaseOffense } from "../lib/titlecase-offense";

// Detroit — RMS_Crime_Incidents on services2.arcgis.com.
// ESRI Feature Server, same shape as Denver. Detroit's old Socrata endpoint
// on data.detroitmi.gov was retired; this ArcGIS feed is the canonical
// public source.
// Doc: https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/RMS_Crime_Incidents/FeatureServer

const BASE = "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/RMS_Crime_Incidents/FeatureServer/0/query";
const PAGE_SIZE = 2000;
// v26 bump 5 → 15. Even after the v26 classifier fix that picked
// up AGGRAVATED ASSAULT / HOMICIDE / SEXUAL ASSAULT, the 10k cache
// only spans ~12 days of Detroit's high crime volume; deeper cache
// gives the annualization a true year-scale window.
const PAGES = 15;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface DetroitRow {
  crime_id?: string;
  offense_category?: string;     // ALL-CAPS: "DAMAGE TO PROPERTY", "ASSAULT"
  offense_description?: string;
  incident_occurred_at?: number; // epoch ms
  neighborhood?: string;
  council_district?: number;
  police_precinct?: string | null;
  latitude?: number;
  longitude?: number;
}

// Detroit DPD splits violent crime across SEVEN distinct
// offense_category strings. The prior set (v24 and earlier) only
// captured 4 of them — AGGRAVATED ASSAULT, SEXUAL ASSAULT, and
// HOMICIDE were silently classified as SOCIETY, dropping ~88k
// violent incidents per year out of the PERSONS bucket. That made
// Detroit's local violent rate look like 29% of the FBI Part-1
// baseline and earned the city a misleading Grade A. v25
// added the divergence guard; v26 fixes the underlying mapping.
const PERSONS_CATEGORIES = new Set([
  "ASSAULT", "AGGRAVATED ASSAULT", "MURDER", "HOMICIDE", "JUSTIFIABLE HOMICIDE",
  "ROBBERY", "SEX OFFENSES", "SEXUAL ASSAULT",
  "KIDNAPPING", "FAMILY OFFENSE", "HUMAN TRAFFICKING",
]);
const PROPERTY_CATEGORIES = new Set([
  "BURGLARY", "LARCENY", "MOTOR VEHICLE THEFT", "STOLEN VEHICLE",
  "ARSON", "DAMAGE TO PROPERTY", "FRAUD", "FORGERY", "STOLEN PROPERTY",
  "EMBEZZLEMENT", "EXTORTION",
]);
function mapToNibrs(row: DetroitRow): CrimeCategory {
  const c = (row.offense_category ?? "").trim().toUpperCase();
  if (PERSONS_CATEGORIES.has(c)) return CrimeCategory.PERSONS;
  if (PROPERTY_CATEGORIES.has(c)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "Detroit RMS Crime Incidents (City of Detroit Open Data, ArcGIS Feature Server)",
  datasetUrl: "https://data.detroitmi.gov/datasets/rms-crime-incidents",
  recency: "Refreshed daily by the Detroit Police Department",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Detroit Police Department and aggregated " +
    "to Detroit's named neighborhoods — not live, not street-level. CommunitySafe " +
    "does not track individuals.",
};

async function fetchPage(offset: number): Promise<DetroitRow[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "crime_id,offense_category,offense_description,incident_occurred_at,neighborhood,council_district,police_precinct,latitude,longitude");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "incident_occurred_at DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("f", "json");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/CommunitySafe)" },
  });
  if (!res.ok) throw new Error(`Detroit ArcGIS ${res.status} offset=${offset}`);
  const body = await res.json() as { features?: Array<{ attributes: DetroitRow }> };
  return (body.features ?? []).map((f) => f.attributes);
}

async function fetchDetroit(): Promise<Incident[]> {
  const pages = await Promise.all(
    Array.from({ length: PAGES }, (_, i) => fetchPage(i * PAGE_SIZE).catch(() => [] as DetroitRow[])),
  );
  const rows = pages.flat();
  // Drop rows with no parseable date — see nypd-socrata for rationale.
  // Epoch fallback would collapse Detroit citywide windowDays to 0.
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.incident_occurred_at == null) continue;
    const d = new Date(r.incident_occurred_at);
    if (Number.isNaN(d.getTime()) || d.getTime() <= 0) continue;
    const lat = r.latitude;
    const lon = r.longitude;
    const area = r.neighborhood?.trim() || "Unknown";
    // Detroit prints offense_description with trailing whitespace padding —
    // trim it so the autocomplete + drill-down read cleanly.
    const desc = r.offense_description?.trim().replace(/\s+/g, " ") || r.offense_category?.trim() || "Unknown";
    out.push({
      id: `det-${r.crime_id ?? i}`,
      area,
      occurredAt: d.toISOString(),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: titleCaseOffense(desc),
      beat: r.police_precinct ?? null,
      blockLabel: undefined,
      lat: typeof lat === "number" && lat !== 0 ? lat : undefined,
      lng: typeof lon === "number" && lon !== 0 ? lon : undefined,
    });
  }
  return out;
}

export async function getRowsDetroit(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchDetroit();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[detroit] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasDetroit(): Promise<KnownArea[]> {
  const rows = await getRowsDetroit();
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
      slug: `det-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Detroit",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForDetroitSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("det-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const detroitAdapter: CrimeDataAdapter = {
  name: "detroit-arcgis",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsDetroit();
    const label = labelForDetroitSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 800 ? 5 : inArea.length > 400 ? 4 : inArea.length > 200 ? 3 : inArea.length > 60 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsDetroit();
    const label = labelForDetroitSlug(area, rows);
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
