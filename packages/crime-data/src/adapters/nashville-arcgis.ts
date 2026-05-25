import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";
import { nashvillePolygons } from "../data/nashville-neighborhoods";

// Nashville — MNPD Police Department Incidents.
// ArcGIS FeatureServer on services2.arcgis.com. Refreshed daily, with
// incidents reaching the public view within ~24h of the dispatched call.
//
// IMPORTANT: the upstream layer carries demographic columns (Victim_Race,
// Victim_Ethnicity, Victim_Gender, Victim_Description with age range). We
// EXPLICITLY enumerate `outFields` to OMIT all of those at request time —
// they never reach our server.
//
// The publicly-exposed Zone / RPA fields are mostly null on recent rows,
// so we geocode each incident's lat/lng through MNPD's 9 published
// precinct polygons (Police_Precinct_Boundaries_view) to surface a
// human-readable area like "East Nashville" or "Midtown Hills".

const BASE = "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Metro_Nashville_Police_Department_Incidents_view/FeatureServer/0/query";
const PAGE_SIZE = 2000;
const PAGES = 5;                // 10k rows
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface NashRow {
  Primary_Key?: string;
  Incident_Number?: number;
  Incident_Occurred?: number;
  Incident_Reported?: number;
  Offense_NIBRS?: string;
  Offense_Description?: string;
  Incident_Location?: string;
  Latitude?: number;
  Longitude?: number;
  Zone?: number;
  ZIP_Code?: string;
}

// NIBRS code prefix → group. (PDF reference: FBI Crime Data Explorer.)
// Persons: 09 (homicide), 11 (kidnapping/abduction), 13 (assault), 36 (sex),
//          64 (human trafficking)
// Property: 12 (extortion), 22 (burglary), 23 (larceny), 24 (motor vehicle
//           theft), 25 (counterfeiting), 26 (fraud), 27 (embezzlement),
//           28 (stolen property), 29 (destruction/vandalism), 120 (robbery),
//           200/240 (arson)
// Everything else (35 drugs, 40 prostitution, 90* group B, 5xx weapons,
// 70x family/all-other) → society.
function nibrsCodeGroup(code: string | undefined): CrimeCategory {
  if (!code) return CrimeCategory.SOCIETY;
  const c = code.trim().toUpperCase();
  if (/^(09|10|11|13|36|64)/.test(c)) return CrimeCategory.PERSONS;
  if (/^(12|22|23|24|25|26|27|28|29|120|200|240)/.test(c)) return CrimeCategory.PROPERTY;
  // Description-based fallback for codes that don't match the prefixes —
  // some MNPD rows use 740 (police inquiry) or proprietary numbers.
  return CrimeCategory.SOCIETY;
}

function mapToNibrs(row: NashRow): CrimeCategory {
  const fromCode = nibrsCodeGroup(row.Offense_NIBRS);
  if (fromCode !== CrimeCategory.SOCIETY) return fromCode;
  // Keyword fallback for offense_description.
  const t = (row.Offense_Description ?? "").toUpperCase();
  if (/(ASSAULT|HOMICIDE|MURDER|KIDNAPP|SEX OFF|RAPE|INTIMID|THREAT)/.test(t)) return CrimeCategory.PERSONS;
  if (/(THEFT|LARC|BURG|MV THEFT|STOLEN|ROBBERY|ARSON|FORGERY|FRAUD|VANDAL|DAMAGE|EMBEZ|COUNTERFEIT)/.test(t)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// ---- Point-in-polygon ------------------------------------------------------

interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = nashvillePolygons.map((p) => {
  const rings: number[][][] = p.geometry.type === "Polygon"
    ? (p.geometry.coordinates as number[][][])
    : (p.geometry.coordinates as number[][][][]).flat();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { name: p.name, bbox: [minX, minY, maxX, maxY], rings };
});

function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function geocodeNashville(lng: number, lat: number): string | null {
  for (const p of POLY_INDEX) {
    const [minX, minY, maxX, maxY] = p.bbox;
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
    let parity = 0;
    for (const ring of p.rings) if (pointInRing(lng, lat, ring)) parity++;
    if (parity % 2 === 1) return p.name;
  }
  return null;
}

const PROVENANCE: DataProvenance = {
  source: "Metro Nashville Police Department Incidents (NashvilleOpenData, ArcGIS Feature Server)",
  datasetUrl: "https://data.nashville.gov/Police/Metro-Nashville-Police-Department-Incidents/2u6v-ujjs",
  recency: "Refreshed daily by MNPD",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by Metro Nashville Police Department and " +
    "aggregated to MNPD's 9 named precincts. CommunitySafe explicitly excludes " +
    "the victim demographic columns (race, ethnicity, gender, age range) " +
    "published by MNPD from every request — they never reach our server.",
};

async function fetchPage(offset: number): Promise<NashRow[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", "Latitude IS NOT NULL AND Latitude <> 0");
  // EXPLICIT outFields — never request demographic columns
  url.searchParams.set("outFields", "Primary_Key,Incident_Number,Incident_Occurred,Offense_NIBRS,Offense_Description,Incident_Location,Latitude,Longitude,Zone,ZIP_Code");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "Incident_Occurred DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("f", "json");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/CommunitySafe)" },
  });
  if (!res.ok) throw new Error(`Nashville ArcGIS ${res.status} offset=${offset}`);
  const body = await res.json() as { features?: Array<{ attributes: NashRow }> };
  return (body.features ?? []).map((f) => f.attributes);
}

async function fetchNashville(): Promise<Incident[]> {
  const pages = await Promise.all(
    Array.from({ length: PAGES }, (_, i) => fetchPage(i * PAGE_SIZE).catch(() => [] as NashRow[])),
  );
  const rows = pages.flat();
  return rows.map((r, i) => {
    const lat = r.Latitude;
    const lng = r.Longitude;
    let area = "Unknown";
    if (typeof lat === "number" && typeof lng === "number" && lat !== 0 && lng !== 0) {
      area = geocodeNashville(lng, lat) ?? "Unknown";
    }
    return {
      id: `nas-${r.Primary_Key ?? r.Incident_Number ?? i}`,
      area,
      occurredAt: r.Incident_Occurred ? new Date(r.Incident_Occurred).toISOString() : new Date(0).toISOString(),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.Offense_Description?.trim() || "Unknown",
      beat: r.Zone != null ? `Zone ${r.Zone}` : (r.ZIP_Code ? `ZIP ${r.ZIP_Code.replace(/\.0$/, "")}` : null),
      blockLabel: undefined,
      lat: typeof lat === "number" && lat !== 0 ? lat : undefined,
      lng: typeof lng === "number" && lng !== 0 ? lng : undefined,
    };
  });
}

export async function getRowsNashville(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchNashville();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[nas] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasNashville(): Promise<KnownArea[]> {
  const rows = await getRowsNashville();
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
      slug: `nas-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Nashville",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForNashvilleSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("nas-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const nashvilleAdapter: CrimeDataAdapter = {
  name: "nashville-arcgis",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsNashville();
    const label = labelForNashvilleSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 1500 ? 5 : inArea.length > 800 ? 4 : inArea.length > 400 ? 3 : inArea.length > 100 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsNashville();
    const label = labelForNashvilleSlug(area, rows);
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
