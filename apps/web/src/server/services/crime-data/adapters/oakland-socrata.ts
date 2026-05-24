import "server-only";
import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";
import { oaklandPolygons } from "../../../data/oakland-neighborhoods";

// Oakland — OPD Crime Reports.
// Socrata dataset 3xav-7geq on data.oaklandca.gov. The dataset stamps each
// incident with a `policebeat` like "19X" but no neighborhood name. We
// geocode each incident's location_1 Point through Oakland's 131 named
// neighborhood polygons at intake so the area surfaces as e.g. "Coliseum"
// or "Redwood Heights" rather than "30X".
// Doc: https://dev.socrata.com/foundry/data.oaklandca.gov/3xav-7geq

const BASE = "https://data.oaklandca.gov/resource/3xav-7geq.json";
const ROW_LIMIT = 5_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface OakRow {
  casenumber?: string;
  crimetype?: string;            // ALL-CAPS broad category ("VANDALISM", "BURGLARY", etc.)
  description?: string;          // Specific offense / penal-code label
  policebeat?: string;
  datetime?: string;             // ISO timestamp
  address?: string;
  city?: string;
  location_1?: { type: "Point"; coordinates: [number, number] };
}

const PERSONS_TYPES = new Set([
  "ASSAULT", "ROBBERY", "HOMICIDE", "MURDER", "RAPE", "SEX OFFENSE",
  "KIDNAPPING", "HARASSMENT", "DOMESTIC VIOLENCE",
]);
const PROPERTY_TYPES = new Set([
  "THEFT", "BURGLARY", "MOTOR VEHICLE THEFT", "VEHICLE THEFT",
  "STOLEN VEHICLE", "VANDALISM", "ARSON", "FRAUD", "EMBEZZLEMENT",
]);
function mapToNibrs(row: OakRow): CrimeCategory {
  const t = (row.crimetype ?? "").trim().toUpperCase();
  if (PERSONS_TYPES.has(t)) return CrimeCategory.PERSONS;
  if (PROPERTY_TYPES.has(t)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// ---- Point-in-polygon ------------------------------------------------------

interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = oaklandPolygons.map((p) => {
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

function geocodeOakland(lng: number, lat: number): string | null {
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
  source: "Oakland Police Department Crime Reports (City of Oakland Open Data)",
  datasetUrl: "https://data.oaklandca.gov/Public-Safety/CrimeWatch-Maps-Crime-Reports/3xav-7geq",
  recency: "Refreshed daily by OPD; ~1-2 day reporting lag",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Oakland Police Department, with neighborhood " +
    "assigned by point-in-polygon geocoding against Oakland's 131 named neighborhoods. " +
    "Not live, not street-level. CommunitySafe does not track individuals.",
};

function safeIso(raw: string | null | undefined): string {
  if (!raw) return new Date(0).toISOString();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

async function fetchOakland(): Promise<Incident[]> {
  // Pull only rows with coordinates so we can geocode them. Sort DESC by
  // datetime so we get the freshest slice.
  const u = `${BASE}?$limit=${ROW_LIMIT}&$order=datetime%20DESC&$where=location_1%20IS%20NOT%20NULL`;
  const res = await fetch(u, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/CommunitySafe)" },
  });
  if (!res.ok) throw new Error(`Oakland Socrata ${res.status}`);
  const rows = (await res.json()) as OakRow[];
  return rows.map((r, i) => {
    const c = r.location_1?.coordinates;
    const lng = Array.isArray(c) ? Number(c[0]) : NaN;
    const lat = Array.isArray(c) ? Number(c[1]) : NaN;
    // Real Oakland neighborhood names only — no opaque "Beat 19X"
    // labels. When geocodeOakland() can't resolve the point to a
    // known neighborhood polygon (or the row lacks coords), the
    // incident is dropped from neighborhood discovery downstream
    // (the discovery filter explicitly skips area === "Unknown"),
    // which slightly undercounts but is honest about what we know.
    let area = "Unknown";
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
      area = geocodeOakland(lng, lat) ?? "Unknown";
    }
    return {
      id: `oak-${r.casenumber ?? i}`,
      area,
      occurredAt: safeIso(r.datetime),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.description?.trim() || r.crimetype?.trim() || "Unknown",
      beat: r.policebeat ?? null,
      blockLabel: r.address ?? undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lng) && lng !== 0 ? lng : undefined,
    };
  });
}

export async function getRowsOakland(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchOakland();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[oakland] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasOakland(): Promise<KnownArea[]> {
  const rows = await getRowsOakland();
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
      slug: `oak-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Oakland",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForOaklandSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("oak-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const oaklandAdapter: CrimeDataAdapter = {
  name: "oakland-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsOakland();
    const label = labelForOaklandSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 300 ? 5 : inArea.length > 160 ? 4 : inArea.length > 80 ? 3 : inArea.length > 30 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsOakland();
    const label = labelForOaklandSlug(area, rows);
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
