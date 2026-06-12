import { CrimeCategory } from "../crime-category.js";
import { readJson } from "../lib/http.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { houstonPolygons, houstonPoints } from "../data/houston-neighborhoods.js";

// Houston, TX — Houston Police Department NIBRS crime on the City of Houston
// ArcGIS Online org (services.arcgis.com/NummVBqZSIJKUeVR). The yearly NIBRS
// cases feed carries per-incident Latitude/Longitude + a NIBRS class, so
// incidents are placed in RECOGNIZABLE NAMED NEIGHBORHOODS (Montrose, The
// Heights, Acres Homes, Alief, Midtown…) by point-in-polygon. Houston publishes
// no official named-neighborhood boundaries, so the shapes come from
// OpenStreetMap (© OpenStreetMap contributors, ODbL), clipped to the Houston
// city boundary — see data/houston-neighborhoods.ts. The crime DATA is official
// HPD. NOTE: this published feed is the complete-year NIBRS file (through 2024);
// HPD's current 30-day feed publishes no usable coordinates, so — like Phoenix's
// archival feed — the provenance states the data vintage honestly.
const BASE = "https://services.arcgis.com/NummVBqZSIJKUeVR/arcgis/rest/services/HPD_NIBRS_Yearly_Cases/FeatureServer/0/query";
const PAGE_SIZE = 2000;
// v113 — Houston runs ~570 incidents/day, so 6 pages (12k) spanned only ~21
// days → the citywide score read "low confidence" (window < the 90-day / 42-day
// + 1.5k-incident high bar) until the background deepen finished. Fetch 16 pages
// (~32k incidents ≈ 56 days) up front so the FIRST cold score is already
// high-confidence; the deepen still backfills the rest for full-depth baselines.
const RECENT_PAGES = 16;
const PAGES = 30;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[]; full: boolean } | null = null;
let lastGoodAreas: KnownArea[] | null = null;
let bgDeepenInFlight = false;
registerRowCache(() => { cache = null; }, "houston-arcgis");

interface HpdRow {
  Latitude?: number;
  Longitude?: number;
  HPD_NIBRSClass?: string;
  HPD_NIBRSDescription?: string;
  HPD_Occurrence_Date?: number; // epoch ms
  HPD_Incident?: string;
  HPD_StreetName?: string;
}

const PERSONS_KEYS = ["ASSAULT", "ROBBERY", "HOMICIDE", "MURDER", "MANSLAUGHTER", "KIDNAP", "SEX", "RAPE", "HUMAN TRAFFICK"];
const PROPERTY_KEYS = ["THEFT", "BURGLARY", "B&E", "LARCENY", "MOTOR VEHICLE", "ARSON", "VANDAL", "DAMAGE", "FORGERY", "FRAUD", "EMBEZZLE", "COUNTERFEIT", "STOLEN", "SHOPLIFT"];
function mapToNibrs(r: HpdRow): CrimeCategory {
  const t = (r.HPD_NIBRSDescription ?? "").toUpperCase();
  if (PERSONS_KEYS.some((k) => t.includes(k))) return CrimeCategory.PERSONS;
  if (PROPERTY_KEYS.some((k) => t.includes(k))) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "Houston Police Department NIBRS Crime (City of Houston Open Data, ArcGIS) · neighborhood boundaries © OpenStreetMap contributors (ODbL)",
  datasetUrl: "https://data.houstontx.gov/dataset/houston-police-department-crime-statistics",
  recency: "Rates: complete-year NIBRS file (through 2024) · recent-report feed: HPD rolling recent-crime layer (days old)",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Houston Police Department under NIBRS and placed in a " +
    "recognizable named neighborhood by their published coordinate. Houston publishes no official " +
    "named-neighborhood boundaries, so neighborhood shapes are sourced from OpenStreetMap " +
    "(© OpenStreetMap contributors, ODbL). This is HPD's complete-year file (through 2024); HPD's " +
    "current feed does not publish usable coordinates.",
};

// --- Neighborhood assignment: point-in-polygon + nearest-name snap ---
interface HouPolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const HOU_POLY_INDEX: HouPolyIndex[] = houstonPolygons.map((p) => {
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
const HOU_SNAP_TARGETS: Array<{ name: string; lng: number; lat: number }> = [
  ...houstonPolygons.map((p) => ({ name: p.name, lng: p.centroid.lng, lat: p.centroid.lat })),
  ...houstonPoints.map((p) => ({ name: p.name, lng: p.lng, lat: p.lat })),
];
const HOU_SNAP_CAP_KM = 1.6;
function houPointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function houNeighborhoodForPoint(lng: number, lat: number): string | null {
  for (const p of HOU_POLY_INDEX) {
    if (lng < p.bbox[0] || lng > p.bbox[2] || lat < p.bbox[1] || lat > p.bbox[3]) continue;
    let inside = false;
    for (const ring of p.rings) if (houPointInRing(lng, lat, ring)) inside = !inside;
    if (inside) return p.name;
  }
  return null;
}
function houSnapToNearest(lng: number, lat: number): string | null {
  let best: string | null = null;
  let bestKm = HOU_SNAP_CAP_KM;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (const t of HOU_SNAP_TARGETS) {
    const d = Math.hypot((t.lng - lng) * cosLat * 111.32, (t.lat - lat) * 111.32);
    if (d < bestKm) { bestKm = d; best = t.name; }
  }
  return best;
}
export function resolveHoustonArea(lat: number | undefined, lng: number | undefined): string | null {
  if (typeof lat === "number" && typeof lng === "number" && lat > 28 && lat < 31) {
    return houNeighborhoodForPoint(lng, lat) ?? houSnapToNearest(lng, lat);
  }
  return null;
}

// --- Rolling recent layer (dual-source recency) ---------------------------
// HPD's self-hosted ArcGIS server publishes a rolling recent-crime layer with
// per-incident points and NIBRS class/description, current to ~days
// (verified 2026-06-12: newest row was the previous day; ~4.6k rows ≈ a
// week's volume). It feeds ONLY getRecentReports below, so the "Recent
// reports" surfaces show genuinely fresh incidents. It must NEVER feed
// getIncidents/getAreaStats: the safety-score window anchors at the newest
// row, so splicing a days-deep feed onto the 2024 yearly file would shrink
// the 364-day numerator to ~a week of incidents and inflate Houston's grade
// ~50×. Rates stay on the complete-year file until HPD publishes 2025.
const ROLLING_BASE =
  "https://mycity2.houstontx.gov/pubgis02/rest/services/HPD/NIBRS_Recent_Crime_Reports/FeatureServer/0/query";
const ROLLING_PAGE = 2000;
const ROLLING_MAX_PAGES = 4;
const ROLLING_TTL_MS = 5 * 60 * 1000;

interface RollingRow {
  USER_RMSOccurrenceDate?: number; // epoch ms (date at midnight)
  USER_RMSOccurrenceHour?: string; // "00".."23"
  USER_Incident?: string;
  USER_NIBRSDescription?: string;
  USER_StreetName?: string;
  USER_Beat?: string;
}
interface RollingFeature { attributes: RollingRow; geometry?: { x?: number; y?: number } }

let rollingCache: { fetchedAt: number; rows: Incident[] } | null = null;
let rollingInFlight: Promise<Incident[]> | null = null;
registerRowCache(() => { rollingCache = null; }, "houston-rolling");

async function fetchRollingPage(offset: number): Promise<RollingFeature[]> {
  const url = new URL(ROLLING_BASE);
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "USER_RMSOccurrenceDate,USER_RMSOccurrenceHour,USER_Incident,USER_NIBRSDescription,USER_StreetName,USER_Beat");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326"); // server reprojects to WGS84 for us
  url.searchParams.set("orderByFields", "USER_RMSOccurrenceDate DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(ROLLING_PAGE));
  url.searchParams.set("f", "json");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Houston rolling ${res.status} offset=${offset}`);
  const body = (await readJson(res)) as { features?: RollingFeature[]; error?: unknown };
  if (body.error) throw new Error(`Houston rolling error: ${JSON.stringify(body.error).slice(0, 120)}`);
  return body.features ?? [];
}

function mapRollingFeatures(features: RollingFeature[]): Incident[] {
  const out: Incident[] = [];
  for (let i = 0; i < features.length; i++) {
    const a = features[i].attributes;
    const g = features[i].geometry;
    if (a.USER_RMSOccurrenceDate == null) continue;
    const hour = Number(a.USER_RMSOccurrenceHour);
    const ms = a.USER_RMSOccurrenceDate + (Number.isFinite(hour) ? hour * 3_600_000 : 0);
    const d = new Date(ms);
    if (Number.isNaN(d.getTime()) || d.getTime() <= 0) continue;
    const lat = typeof g?.y === "number" ? g.y : undefined;
    const lng = typeof g?.x === "number" ? g.x : undefined;
    const area = resolveHoustonArea(lat, lng);
    if (!area) continue;
    out.push({
      id: `hou-r-${a.USER_Incident ?? i}`,
      area,
      occurredAt: d.toISOString(),
      nibrsCategory: mapToNibrs({ HPD_NIBRSDescription: a.USER_NIBRSDescription }),
      ibrOffenseDescription: a.USER_NIBRSDescription?.trim() || "Unknown",
      beat: a.USER_Beat ?? null,
      blockLabel: a.USER_StreetName ?? undefined,
      lat,
      lng,
    });
  }
  return out;
}

async function getRollingRows(): Promise<Incident[]> {
  const now = Date.now();
  if (rollingCache && now - rollingCache.fetchedAt < ROLLING_TTL_MS) return rollingCache.rows;
  if (rollingInFlight) return rollingInFlight;
  rollingInFlight = (async () => {
    try {
      const features: RollingFeature[] = [];
      for (let page = 0; page < ROLLING_MAX_PAGES; page++) {
        const batch = await fetchRollingPage(page * ROLLING_PAGE);
        features.push(...batch);
        if (batch.length < ROLLING_PAGE) break;
      }
      const rows = mapRollingFeatures(features);
      if (rows.length > 0) rollingCache = { fetchedAt: now, rows };
      return rows.length > 0 ? rows : (rollingCache?.rows ?? []);
    } catch (err) {
      console.warn("[houston] rolling fetch failed:", (err as Error).message);
      return rollingCache?.rows ?? [];
    } finally {
      rollingInFlight = null;
    }
  })();
  return rollingInFlight;
}

async function fetchPage(offset: number): Promise<HpdRow[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", "Latitude>0");
  url.searchParams.set("outFields", "Latitude,Longitude,HPD_NIBRSDescription,HPD_Occurrence_Date,HPD_Incident,HPD_StreetName");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "HPD_Occurrence_Date DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("f", "json");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Houston ArcGIS ${res.status} offset=${offset}`);
  const body = (await readJson(res)) as { features?: Array<{ attributes: HpdRow }>; error?: unknown };
  if (body.error) throw new Error(`Houston ArcGIS error offset=${offset}: ${JSON.stringify(body.error).slice(0, 120)}`);
  return (body.features ?? []).map((f) => f.attributes);
}

function mapRows(rows: HpdRow[]): Incident[] {
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.HPD_Occurrence_Date == null) continue;
    const d = new Date(r.HPD_Occurrence_Date);
    if (Number.isNaN(d.getTime()) || d.getTime() <= 0) continue;
    const lat = typeof r.Latitude === "number" ? r.Latitude : undefined;
    const lng = typeof r.Longitude === "number" ? r.Longitude : undefined;
    const area = resolveHoustonArea(lat, lng);
    if (!area) continue;
    out.push({
      id: `hou-${r.HPD_Incident ?? i}`,
      area,
      occurredAt: d.toISOString(),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.HPD_NIBRSDescription?.trim() || "Unknown",
      beat: null,
      blockLabel: r.HPD_StreetName ?? undefined,
      lat,
      lng,
    });
  }
  return out;
}

async function fetchRange(startPage: number, endPage: number): Promise<Incident[]> {
  const offsets = Array.from({ length: endPage - startPage }, (_, i) => (startPage + i) * PAGE_SIZE);
  const results: HpdRow[][] = new Array(offsets.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, offsets.length) }, async () => {
    for (;;) {
      const idx = cursor++;
      if (idx >= offsets.length) return;
      results[idx] = await fetchPage(offsets[idx]).catch(() => [] as HpdRow[]);
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
    console.warn("[houston] deepen failed:", (err as Error).message);
  } finally {
    bgDeepenInFlight = false;
  }
}

let inFlight: Promise<Incident[]> | null = null;
export async function getRowsHouston(): Promise<Incident[]> {
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
      console.warn("[houston] fetch failed:", (err as Error).message);
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
      slug: `hou-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Houston",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function getDiscoveredAreasHouston(): Promise<KnownArea[]> {
  if (cache && cache.rows.length > 0) return buildAreas(cache.rows);
  if (lastGoodAreas && lastGoodAreas.length > 0) {
    void getRowsHouston().catch(() => {});
    return lastGoodAreas;
  }
  const rows = await getRowsHouston().catch(() => [] as Incident[]);
  if (rows.length === 0) return [];
  return buildAreas(rows);
}

function labelForSlug(slug: string, rows: Incident[]): string | null {
  const want = (slug.startsWith("hou-") ? slug.slice(4) : slug).toLowerCase();
  for (const r of rows) {
    const cand = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (cand === want) return r.area;
  }
  return null;
}

export const houstonAdapter: CrimeDataAdapter = {
  name: "houston-arcgis",
  isComplete: () => cache?.full ?? false,

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsHouston();
    const label = labelForSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [50, 150, 300, 600]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsHouston();
    const label = labelForSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },

  async getRecentReports(area: string, opts?: { limit?: number }) {
    // Recency rides the rolling recent-crime layer (days old); the yearly
    // archival rows fill the list when the area is quiet this week. Scoring
    // paths (getIncidents/getAreaStats) intentionally stay on the yearly file
    // — see the ROLLING_BASE note about window anchoring.
    const limit = opts?.limit ?? 20;
    const rolling = await getRollingRows().catch(() => [] as Incident[]);
    const label = labelForSlug(area, rolling) ?? labelForSlug(area, await getRowsHouston());
    if (!label) return [];
    const fresh = rolling.filter((r) => r.area === label);
    fresh.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    if (fresh.length >= limit) return fresh.slice(0, limit);
    const yearly = await this.getIncidents(area, { limit });
    return [...fresh, ...yearly].slice(0, limit);
  },
};
