import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { fetchSocrata } from "../lib/http.js";
import { coSpPolygons } from "../data/colorado-springs-neighborhoods.js";

// Colorado Springs PD — "Crime Level Data" on policedata.coloradosprings.gov.
// Socrata dataset bc88-hemr. Public, no auth required. Replaces Denver
// after Denver's ArcGIS feed went token-gated.
// Doc: https://policedata.coloradosprings.gov/Public-Safety/Crime-Level-Data/bc88-hemr
//
// Granularity: point-in-polygon geocoding against Colorado Springs'
// 78 named neighborhood polygons (Roswell, The Farm, Old Colorado
// City, etc.) — sourced from the public city ArcGIS Hub item
// 8b3a02c167a34174b4697e5973b6763e. Matches the Oakland / NOLA
// pattern. When a point doesn't fall in a known polygon we fall
// back to the patrol_division name so we never lose the row.

const BASE = "https://policedata.coloradosprings.gov/resource/bc88-hemr.json";
const ROW_LIMIT = 5_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface CoSpRow {
  casenumber?: string;
  occurredfromdate?: string;
  reporteddate?: string;
  crimecodedescription?: string;
  crimecode?: string;
  statutedescription?: string;
  index_crime_category?: string;   // "Crimes Against Property" / "Crimes Against Persons" / "Crimes Against Society"
  streetaddress?: string;
  zip?: string;
  patrol_division?: string;        // "Falcon" / "Sand Creek" / "Stetson Hills" / "Gold Hill"
  location_point?: { type: "Point"; coordinates: [number, number] };
}

function mapToNibrs(row: CoSpRow): CrimeCategory {
  const v = (row.index_crime_category ?? "").trim().toLowerCase();
  if (v.includes("persons")) return CrimeCategory.PERSONS;
  if (v.includes("property")) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// CSPD patrol division centroids — used only as a last-resort
// fallback when a row's coords don't fall in any known neighborhood
// polygon AND we can't read the patrol_division.
const DIVISION_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  "Sand Creek":    { lat: 38.835, lng: -104.731 },
  "Gold Hill":     { lat: 38.835, lng: -104.825 },
  "Stetson Hills": { lat: 38.910, lng: -104.755 },
  "Falcon":        { lat: 38.970, lng: -104.640 },
};

// ---- Point-in-polygon ------------------------------------------------------

interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = coSpPolygons.map((p) => {
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

function geocodeCoSp(lng: number, lat: number): string | null {
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
  source: "Colorado Springs Police Department Crime Level Data (CSPD Open Data)",
  datasetUrl: "https://policedata.coloradosprings.gov/Public-Safety/Crime-Level-Data/bc88-hemr",
  recency: "Refreshed daily by CSPD; ~1-2 day reporting lag",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Colorado Springs Police Department, with " +
    "neighborhood assigned by point-in-polygon geocoding against Colorado " +
    "Springs' 78 named neighborhood polygons. When a row lacks coordinates " +
    "we fall back to CSPD's patrol division (Sand Creek, Gold Hill, Stetson " +
    "Hills, Falcon). Not live, not street-level. TravelSafe does not track " +
    "individuals.",
};

function safeIso(raw: string | null | undefined): string {
  if (!raw) return new Date(0).toISOString();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

async function fetchCoSp(): Promise<Incident[]> {
  // v96 — migrated to fetchSocrata helper.
  // Pull the freshest slice. `occurredfromdate IS NOT NULL` guards
  // against partially-filed rows. CSPD also publishes a sparser
  // `reporteddate`; using occurred-date keeps timestamps aligned
  // with when the incident actually happened.
  const rows = await fetchSocrata<CoSpRow>("CoSp Socrata", {
    url: BASE,
    where: "occurredfromdate IS NOT NULL",
    order: "occurredfromdate DESC",
    limit: ROW_LIMIT,
  });
  return rows.map((r, i) => {
    const c = r.location_point?.coordinates;
    const lng = Array.isArray(c) ? Number(c[0]) : NaN;
    const lat = Array.isArray(c) ? Number(c[1]) : NaN;
    // Try polygon geocoding first → named neighborhood. Fall back
    // to patrol_division when the point doesn't fall in any
    // polygon (e.g., incidents on highway overpasses near city
    // edges, or rows with imprecise coords). Last-resort
    // "Unknown" preserves the row for raw counts but the
    // discovery filter (count >= 3) drops it from the
    // neighborhood list automatically.
    let area = "Unknown";
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
      area = geocodeCoSp(lng, lat) ?? r.patrol_division?.trim() ?? "Unknown";
    } else if (r.patrol_division) {
      area = r.patrol_division.trim();
    }
    return {
      id: `cosp-${r.casenumber ?? i}`,
      area,
      occurredAt: safeIso(r.occurredfromdate),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.crimecodedescription?.trim() || r.statutedescription?.trim() || "Unknown",
      beat: r.patrol_division ?? null,
      blockLabel: r.streetaddress ?? undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lng) && lng !== 0 ? lng : undefined,
    };
  });
}

export async function getRowsCoSp(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchCoSp();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[colorado-springs] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasCoSp(): Promise<KnownArea[]> {
  const rows = await getRowsCoSp();
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
      slug: `cosp-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Colorado Springs",
      // Row-derived centroid (polygon geocoding guarantees we have
      // real lat/lng for the area). DIVISION_CENTROIDS fallback only
      // applies if every row for an area happened to lack coords —
      // very unlikely once geocoding is on.
      centroid: e.count > 0
        ? { lat: e.latSum / e.count, lng: e.lngSum / e.count }
        : (DIVISION_CENTROIDS[name] ?? { lat: 38.835, lng: -104.825 }),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForCoSpSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("cosp-") ? s.slice(5) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const coloradoSpringsAdapter: CrimeDataAdapter = {
  name: "colorado-springs-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsCoSp();
    const label = labelForCoSpSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    // Risk thresholds for per-neighborhood counts (78 polygons,
    // typical neighborhood holds 50-2000 incidents in the cached
    // 5k-row slice). Aligned with the Oakland scale.
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [30, 80, 160, 300]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsCoSp();
    const label = labelForCoSpSlug(area, rows);
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
