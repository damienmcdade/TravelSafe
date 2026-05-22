import "server-only";
import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";
import dcGeo from "../../../data/dc-neighborhoods.json";

// Washington DC — MPD Crime Incidents.
// ArcGIS MapServer at maps2.dcgis.dc.gov, layer 39 (last 30 days). We
// geocode each incident's LATITUDE/LONGITUDE into one of DC's 51 official
// named neighborhoods (Health Planning Neighborhoods polygon set) via
// point-in-polygon at intake. The MPD-published NEIGHBORHOOD_CLUSTER
// field bundled multiple neighborhoods together — users complained they
// couldn't tell Adams Morgan from Kalorama Heights — so we ignore it now.
// Doc: https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/MPD/MapServer/39

const BASE = "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/MPD/MapServer/39/query";
const PAGE_SIZE = 2000;
const PAGES = 5;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface DcRow {
  CCN?: string;
  OFFENSE?: string;
  METHOD?: string;
  START_DATE?: number;
  WARD?: string;
  DISTRICT?: string;
  LATITUDE?: number;
  LONGITUDE?: number;
}

const PERSONS_OFFENSES = new Set([
  "HOMICIDE", "ASSAULT W/DANGEROUS WEAPON", "ROBBERY", "SEX ABUSE",
]);
const PROPERTY_OFFENSES = new Set([
  "THEFT/OTHER", "THEFT F/AUTO", "MOTOR VEHICLE THEFT", "BURGLARY", "ARSON",
]);
function mapToNibrs(row: DcRow): CrimeCategory {
  const o = (row.OFFENSE ?? "").trim().toUpperCase();
  if (PERSONS_OFFENSES.has(o)) return CrimeCategory.PERSONS;
  if (PROPERTY_OFFENSES.has(o)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// ---- Point-in-polygon geocoding ---------------------------------------------

interface DCPolygon { name: string; geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] } }
const POLYS = (dcGeo as { polygons: DCPolygon[] }).polygons;

// Precompute axis-aligned bounding boxes per polygon for fast rejection.
interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = POLYS.map((p) => {
  const allRings: number[][][] = p.geometry.type === "Polygon"
    ? (p.geometry.coordinates as number[][][])
    : (p.geometry.coordinates as number[][][][]).flat();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of allRings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return { name: p.name, bbox: [minX, minY, maxX, maxY], rings: allRings };
});

function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/// Returns the DC neighborhood name containing (lng, lat), or null if no
/// polygon matches. Uses bbox prefilter so 99% of polygons are rejected
/// before the slower ring test runs.
function geocodeDC(lng: number, lat: number): string | null {
  for (const p of POLY_INDEX) {
    const [minX, minY, maxX, maxY] = p.bbox;
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
    // Point passes bbox — run real ring test. For MultiPolygon-derived
    // ring lists, a point inside an odd number of rings is inside.
    let parity = 0;
    for (const ring of p.rings) if (pointInRing(lng, lat, ring)) parity++;
    if (parity % 2 === 1) return p.name;
  }
  return null;
}

// ---- adapter ----------------------------------------------------------------

const PROVENANCE: DataProvenance = {
  source: "DC MPD Crime Incidents — Last 30 Days (Open Data DC, ArcGIS MapServer)",
  datasetUrl: "https://opendata.dc.gov/datasets/DCGIS::crime-incidents-last-30-days",
  recency: "Refreshed daily by the Metropolitan Police Department",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the DC Metropolitan Police Department, with neighborhood " +
    "assigned by point-in-polygon geocoding against DC's official Health Planning " +
    "Neighborhood polygons. Not live, not street-level. TravelSafe does not track individuals.",
};

async function fetchPage(offset: number): Promise<DcRow[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "CCN,OFFENSE,METHOD,START_DATE,WARD,DISTRICT,LATITUDE,LONGITUDE");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "START_DATE DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("f", "json");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "TravelSafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
  });
  if (!res.ok) throw new Error(`DC ArcGIS ${res.status} offset=${offset}`);
  const body = await res.json() as { features?: Array<{ attributes: DcRow }> };
  return (body.features ?? []).map((f) => f.attributes);
}

async function fetchDC(): Promise<Incident[]> {
  const pages = await Promise.all(
    Array.from({ length: PAGES }, (_, i) => fetchPage(i * PAGE_SIZE).catch(() => [] as DcRow[])),
  );
  const rows = pages.flat();
  return rows.map((r, i) => {
    const lat = r.LATITUDE;
    const lon = r.LONGITUDE;
    // Point-in-polygon geocode every row that has coords. Unmatched rows
    // fall back to the ward number rather than an unhelpful "Unknown".
    let area = "Unknown";
    if (typeof lat === "number" && typeof lon === "number" && lat !== 0 && lon !== 0) {
      area = geocodeDC(lon, lat) ?? (r.WARD ? `Ward ${r.WARD}` : "Unknown");
    } else if (r.WARD) {
      area = `Ward ${r.WARD}`;
    }
    return {
      id: `dc-${r.CCN ?? i}`,
      area,
      occurredAt: r.START_DATE ? new Date(r.START_DATE).toISOString() : new Date(0).toISOString(),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.OFFENSE?.trim() || "Unknown",
      beat: r.DISTRICT ?? null,
      blockLabel: undefined,
      lat: typeof lat === "number" && lat !== 0 ? lat : undefined,
      lng: typeof lon === "number" && lon !== 0 ? lon : undefined,
    };
  });
}

export async function getRowsDC(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchDC();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[dc] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasDC(): Promise<KnownArea[]> {
  const rows = await getRowsDC();
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
      slug: `dc-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Washington",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForDCSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("dc-") ? s.slice(3) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const dcAdapter: CrimeDataAdapter = {
  name: "dc-mpd-arcgis",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsDC();
    const label = labelForDCSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 300 ? 5 : inArea.length > 160 ? 4 : inArea.length > 80 ? 3 : inArea.length > 30 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsDC();
    const label = labelForDCSlug(area, rows);
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
