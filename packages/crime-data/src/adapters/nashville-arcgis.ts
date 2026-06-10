import { CrimeCategory } from "../crime-category.js";
import { readJson } from "../lib/http.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { nashvillePolygons, nashvillePoints } from "../data/nashville-neighborhoods.js";

// Nashville, TN (Metropolitan Nashville-Davidson) — MNPD Incidents on the
// public ArcGIS FeatureServer (services2.arcgis.com/HdTo6HJqh92wn4D8). Rows
// carry Latitude/Longitude + a NIBRS offense code/description, so incidents
// are placed in RECOGNIZABLE NAMED NEIGHBORHOODS (East Nashville, Bordeaux,
// Antioch, Bellevue…) by point-in-polygon. Metro Nashville publishes no
// official named-neighborhood boundary set, so neighborhood shapes come from
// OpenStreetMap (© OpenStreetMap contributors, ODbL), clipped to the Davidson
// County boundary — see data/nashville-neighborhoods.ts. The crime DATA is
// official MNPD. ~76% of incidents land in a named neighborhood by
// coordinate; the rest snap to the nearest within 1.6 km.
const BASE = "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Metro_Nashville_Police_Department_Incidents_view/FeatureServer/0/query";
const PAGE_SIZE = 2000;
const RECENT_PAGES = 6;   // tiered cold load: newest ~12k first, then backfill
const PAGES = 25;         // ~50k recent incidents
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[]; full: boolean } | null = null;
let lastGoodAreas: KnownArea[] | null = null;
let bgDeepenInFlight = false;
registerRowCache(() => { cache = null; }, "nashville-arcgis");

interface MnpdRow {
  Latitude?: number;
  Longitude?: number;
  Offense_NIBRS?: string;
  Offense_Description?: string;
  Incident_Occurred?: number; // epoch ms
  Incident_Number?: string;
  Incident_Location?: string;
}

// NIBRS description → PERSONS / PROPERTY / SOCIETY (same FBI-aligned taxonomy as
// the Charlotte adapter: Robbery is a violent/PERSONS crime per FBI UCR Part 1).
const PERSONS_KEYS = ["ASSAULT", "ROBBERY", "HOMICIDE", "MURDER", "MANSLAUGHTER", "KIDNAP", "SEX", "RAPE", "HUMAN TRAFFICK"];
const PROPERTY_KEYS = ["THEFT", "BURGLARY", "B&E", "LARCENY", "MOTOR VEHICLE", "ARSON", "VANDAL", "DAMAGE", "FORGERY", "FRAUD", "EMBEZZLE", "COUNTERFEIT", "STOLEN", "SHOPLIFT", "ROBBERY OF"];
function mapToNibrs(r: MnpdRow): CrimeCategory {
  const t = (r.Offense_Description ?? "").toUpperCase();
  if (PERSONS_KEYS.some((k) => t.includes(k))) return CrimeCategory.PERSONS;
  if (PROPERTY_KEYS.some((k) => t.includes(k))) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "Metro Nashville Police Department Incidents (Metro Nashville Open Data, ArcGIS FeatureServer) · neighborhood boundaries © OpenStreetMap contributors (ODbL)",
  datasetUrl: "https://data.nashville.gov/datasets/metro-nashville-police-department-incidents",
  recency: "Refreshed daily by MNPD",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Metropolitan Nashville Police Department and placed in a " +
    "recognizable named neighborhood by their public coordinate. Metro Nashville publishes no " +
    "official named-neighborhood boundaries, so neighborhood shapes are sourced from OpenStreetMap " +
    "(© OpenStreetMap contributors, ODbL); incidents outside any mapped neighborhood snap to the nearest.",
};

// --- Neighborhood assignment: point-in-polygon + nearest-name snap (same as Charlotte) ---
interface BnaPolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const BNA_POLY_INDEX: BnaPolyIndex[] = nashvillePolygons.map((p) => {
  const rings: number[][][] =
    p.geometry.type === "Polygon"
      ? (p.geometry.coordinates as number[][][])
      : (p.geometry.coordinates as number[][][][]).flat();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) for (const pt of ring) {
    if (pt[0] < minX) minX = pt[0];
    if (pt[0] > maxX) maxX = pt[0];
    if (pt[1] < minY) minY = pt[1];
    if (pt[1] > maxY) maxY = pt[1];
  }
  return { name: p.name, bbox: [minX, minY, maxX, maxY], rings };
});
const BNA_SNAP_TARGETS: Array<{ name: string; lng: number; lat: number }> = [
  ...nashvillePolygons.map((p) => ({ name: p.name, lng: p.centroid.lng, lat: p.centroid.lat })),
  ...nashvillePoints.map((p) => ({ name: p.name, lng: p.lng, lat: p.lat })),
];
const BNA_SNAP_CAP_KM = 1.6;
function bnaPointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function bnaNeighborhoodForPoint(lng: number, lat: number): string | null {
  for (const p of BNA_POLY_INDEX) {
    if (lng < p.bbox[0] || lng > p.bbox[2] || lat < p.bbox[1] || lat > p.bbox[3]) continue;
    let inside = false;
    for (const ring of p.rings) if (bnaPointInRing(lng, lat, ring)) inside = !inside;
    if (inside) return p.name;
  }
  return null;
}
function bnaSnapToNearest(lng: number, lat: number): string | null {
  let best: string | null = null;
  let bestKm = BNA_SNAP_CAP_KM;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (const t of BNA_SNAP_TARGETS) {
    const d = Math.hypot((t.lng - lng) * cosLat * 111.32, (t.lat - lat) * 111.32);
    if (d < bestKm) { bestKm = d; best = t.name; }
  }
  return best;
}
export function resolveNashvilleArea(lat: number | undefined, lng: number | undefined): string | null {
  if (typeof lat === "number" && typeof lng === "number" && lat !== 0 && lng !== 0) {
    return bnaNeighborhoodForPoint(lng, lat) ?? bnaSnapToNearest(lng, lat);
  }
  return null;
}

async function fetchPage(offset: number): Promise<MnpdRow[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "Latitude,Longitude,Offense_NIBRS,Offense_Description,Incident_Occurred,Incident_Number,Incident_Location");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "Incident_Occurred DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("f", "json");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Nashville ArcGIS ${res.status} offset=${offset}`);
  const body = (await readJson(res)) as { features?: Array<{ attributes: MnpdRow }> };
  return (body.features ?? []).map((f) => f.attributes);
}

function mapRows(rows: MnpdRow[]): Incident[] {
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.Incident_Occurred == null) continue;
    const d = new Date(r.Incident_Occurred);
    if (Number.isNaN(d.getTime()) || d.getTime() <= 0) continue;
    const lat = typeof r.Latitude === "number" && r.Latitude !== 0 ? r.Latitude : undefined;
    const lng = typeof r.Longitude === "number" && r.Longitude !== 0 ? r.Longitude : undefined;
    const area = resolveNashvilleArea(lat, lng);
    if (!area) continue; // no coordinate / outside all neighborhoods → drop (keeps the wheel honest)
    out.push({
      id: `bna-${r.Incident_Number ?? i}`,
      area,
      occurredAt: d.toISOString(),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.Offense_Description?.trim() || "Unknown",
      beat: null,
      blockLabel: r.Incident_Location ?? undefined,
      lat,
      lng,
    });
  }
  return out;
}

async function fetchRange(startPage: number, endPage: number): Promise<Incident[]> {
  const offsets = Array.from({ length: endPage - startPage }, (_, i) => (startPage + i) * PAGE_SIZE);
  const results: MnpdRow[][] = new Array(offsets.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, offsets.length) }, async () => {
    for (;;) {
      const idx = cursor++;
      if (idx >= offsets.length) return;
      results[idx] = await fetchPage(offsets[idx]).catch(() => [] as MnpdRow[]);
    }
  });
  await Promise.all(workers);
  return mapRows(results.flat());
}

async function deepen(recent: Incident[]): Promise<void> {
  if (bgDeepenInFlight) return;
  bgDeepenInFlight = true;
  try {
    const rest = await fetchRange(RECENT_PAGES, PAGES);
    if (rest.length === 0) return;
    const byId = new Map<string, Incident>();
    for (const r of recent) byId.set(r.id, r);
    for (const r of rest) if (!byId.has(r.id)) byId.set(r.id, r);
    const merged = Array.from(byId.values());
    cache = { fetchedAt: Date.now(), rows: merged, full: true };
    lastGoodAreas = buildAreas(merged);
  } catch (err) {
    console.warn("[nashville] deepen failed:", (err as Error).message);
  } finally {
    bgDeepenInFlight = false;
  }
}

let inFlight: Promise<Incident[]> | null = null;
export async function getRowsNashville(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const recent = await fetchRange(0, RECENT_PAGES);
      if (recent.length > 0) {
        cache = { fetchedAt: now, rows: recent, full: false };
        lastGoodAreas = buildAreas(recent);
        void deepen(recent);
        return recent;
      }
      return cache?.rows ?? [];
    } catch (err) {
      console.warn("[nashville] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function buildAreas(rows: Incident[]): KnownArea[] {
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || r.lat == null || r.lng == null) continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat; e.lngSum += r.lng; e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 3)
    .map(([name, e]) => ({
      slug: `bna-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Nashville",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function getDiscoveredAreasNashville(): Promise<KnownArea[]> {
  if (cache && cache.rows.length > 0) return buildAreas(cache.rows);
  if (lastGoodAreas && lastGoodAreas.length > 0) {
    void getRowsNashville().catch(() => {});
    return lastGoodAreas;
  }
  const rows = await getRowsNashville().catch(() => [] as Incident[]);
  if (rows.length === 0) return [];
  return buildAreas(rows);
}

function labelForSlug(slug: string, rows: Incident[]): string | null {
  const want = (slug.startsWith("bna-") ? slug.slice(4) : slug).toLowerCase();
  for (const r of rows) {
    const cand = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (cand === want) return r.area;
  }
  return null;
}

export const nashvilleAdapter: CrimeDataAdapter = {
  name: "nashville-arcgis",
  isComplete: () => cache?.full ?? false,

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsNashville();
    const label = labelForSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [50, 150, 300, 600]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsNashville();
    const label = labelForSlug(area, rows);
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
