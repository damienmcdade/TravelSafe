import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT, readJson, fetchWithRetry } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";
import { albuquerquePolygons } from "../data/albuquerque-neighborhoods.js";

// Albuquerque, NM — City of Albuquerque AGIS "Incidents" FeatureServer. APD
// publishes a rolling ~6-month incident feed (~106k rows, point geometry) with
// a clean crime-category field `CMLegend` (ASSAULT, BURGLARY, THEFT/LARCENY …)
// and an epoch-ms datetime `ReportDateTime`. The raw `IncidentType` is a CAD
// disposition code (e.g. "31S ONSITE SUSPICIOU") so we read CMLegend instead.
//
// IMPORTANT: ~82% of the feed is CMLegend = "DISTURBING THE PEACE", which is
// almost entirely calls-for-service / non-crime (suspicious person, disturbance,
// loud music, missing person, rescue/fire/animal calls, panhandlers). We FILTER
// that bucket out so the feed reads as actual reported crime — the remaining
// ~18% are the real Part-1/Part-2 offenses below.
//
// Each incident lng/lat is geocoded to one of 143 City "Recognized Neighborhood
// Association" polygons via bbox-prefiltered point-in-polygon (same self-contained
// pattern as the Long Beach adapter); points outside every polygon fall back to
// "Unknown" — excluded from discovery but still counted citywide.
// Source: https://coageo.cabq.gov/cabqgeo/rest/services/Incidents/FeatureServer/0

const BASE =
  "https://coageo.cabq.gov/cabqgeo/rest/services/Incidents/FeatureServer/0/query";
const PAGE_SIZE = 2000; // = server maxRecordCount
const WINDOW_DAYS = 400; // covers the full ~6-month feed plus the 365d score window
// Full feed is ~106k rows over a rolling ~6-month window. 60 pages (120k) covers
// it with headroom as the window grows.
const PAGES = 60;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => {
  cache = null;
}, "albuquerque-arcgis");

interface AbqFeature {
  attributes: {
    OBJECTID?: number;
    CallNumber?: string;
    ReportDateTime?: number; // epoch ms (UTC)
    IncidentType?: string; // CAD disposition code — NOT used for classification
    CMLegend?: string; // clean crime category, e.g. "ASSAULT"
    BlockAddress?: string;
  };
  geometry?: { x: number; y: number }; // x=lng, y=lat (WGS84 when outSR=4326)
}

// CMLegend values that are calls-for-service / non-crime and excluded from the
// dataset. The feed's "DISTURBING THE PEACE" bucket is ~82% of rows and is
// overwhelmingly CAD dispositions (suspicious person/vehicle, disturbance, loud
// music, missing person, rescue/fire/animal calls, panhandlers) rather than
// reported crime — counting it would massively distort the safety score.
const NON_CRIME_LEGENDS = new Set(["DISTURBING THE PEACE"]);

// CMLegend → CommunitySafe NIBRS bucket. Robbery is filed by NIBRS under
// Property but the FBI UCR counts it as a Part-1 VIOLENT offense, so force it to
// PERSONS (same convention as the Long Beach / Dallas / Saint Paul adapters).
function classify(legend: string | undefined): CrimeCategory {
  const c = (legend ?? "").toUpperCase();
  if (c.includes("ROBBERY")) return CrimeCategory.PERSONS;
  if (
    c.includes("ASSAULT") ||
    c.includes("HOMICIDE") ||
    c.includes("MURDER") ||
    c.includes("RAPE") ||
    c.includes("SEX") ||
    c.includes("KIDNAP")
  ) {
    return CrimeCategory.PERSONS;
  }
  if (
    c.includes("BURGLARY") ||
    c.includes("THEFT") ||
    c.includes("LARCENY") ||
    c.includes("VEHICLE") ||
    c.includes("AUTO") ||
    c.includes("BREAK-IN") ||
    c.includes("ARSON") ||
    c.includes("VANDALISM") ||
    c.includes("FRAUD")
  ) {
    return CrimeCategory.PROPERTY;
  }
  return CrimeCategory.SOCIETY;
}

// Point-in-polygon geocoder over the 143 official ABQ neighborhood associations.
// bbox-prefiltered ray casting — same self-contained pattern as the Long Beach /
// Indianapolis / Boston adapters.
//
// NOTE: the recognized-neighborhood-association layer does NOT tile the city —
// there are wide gaps between associations (commercial corridors, undeveloped
// land, city edges), so ~half of the incident points fall in a gap rather than
// strictly inside a polygon. To geocode honestly without misattributing, a point
// in a gap is SNAPPED to the nearest association whose boundary is within
// SNAP_CAP_M (a few blocks); points farther than that stay "Unknown" (counted
// citywide, excluded from neighborhood discovery). This lifts coverage from ~51%
// (strict containment only) to ~79%.
const SNAP_CAP_M = 400;
const SNAP_CAP_DEG = SNAP_CAP_M / 111_000; // ~degrees of latitude per metre
interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = albuquerquePolygons.map((p) => {
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
// Squared distance (in degrees) from a point to a line segment.
function distSqToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx, cy = ay + t * dy;
  const ex = px - cx, ey = py - cy;
  return ex * ex + ey * ey;
}
function geocodeAbq(lng: number, lat: number): string | null {
  // 1) strict containment
  for (const p of POLY_INDEX) {
    const [minX, minY, maxX, maxY] = p.bbox;
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
    let parity = 0;
    for (const ring of p.rings) if (pointInRing(lng, lat, ring)) parity++;
    if (parity % 2 === 1) return p.name;
  }
  // 2) gap fallback — snap to the nearest association boundary within SNAP_CAP_M.
  let bestName: string | null = null;
  let bestSq = SNAP_CAP_DEG * SNAP_CAP_DEG;
  for (const p of POLY_INDEX) {
    const [minX, minY, maxX, maxY] = p.bbox;
    if (lng < minX - SNAP_CAP_DEG || lng > maxX + SNAP_CAP_DEG || lat < minY - SNAP_CAP_DEG || lat > maxY + SNAP_CAP_DEG) continue;
    for (const ring of p.rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const d = distSqToSeg(lng, lat, ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]);
        if (d < bestSq) { bestSq = d; bestName = p.name; }
      }
    }
  }
  return bestName;
}

const PROVENANCE: DataProvenance = {
  source: "Albuquerque Police Department (City of Albuquerque AGIS)",
  datasetUrl: "https://coagisweb.cabq.gov/",
  recency: "Refreshed daily by the Albuquerque Police Department (rolling ~6-month incident feed)",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Albuquerque Police Department and geocoded to one of " +
    "143 official Albuquerque neighborhood associations (calls-for-service are excluded) — " +
    "not live, not street-level. CommunitySafe does not track individuals.",
};

function slugify(name: string): string {
  return `abq-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

async function fetchPage(offset: number, sinceTs: string): Promise<AbqFeature[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", `ReportDateTime >= timestamp '${sinceTs}'`);
  url.searchParams.set("outFields", "OBJECTID,CallNumber,ReportDateTime,IncidentType,CMLegend,BlockAddress");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("orderByFields", "ReportDateTime DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Albuquerque ArcGIS ${res.status} offset=${offset}`);
  const body = (await readJson(res)) as { features?: AbqFeature[]; error?: unknown };
  // Throw on the embedded ArcGIS error envelope (HTTP 200 + {error:{...}}) so a
  // token-gated/failed layer serves last-known-good instead of grading as zero-crime.
  if (body.error) throw new Error(`Albuquerque ArcGIS body error offset=${offset}`);
  return body.features ?? [];
}

async function fetchAlbuquerque(): Promise<Incident[]> {
  const sinceTs = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  const results: AbqFeature[][] = new Array(PAGES);
  let cursor = 0;
  const workers = Array.from({ length: 6 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PAGES) return;
      results[i] = await fetchPage(i * PAGE_SIZE, sinceTs).catch(() => [] as AbqFeature[]);
    }
  });
  await Promise.all(workers);
  const feats = results.flat();
  return feats
    .filter((f) => typeof f.attributes.ReportDateTime === "number")
    // Drop the calls-for-service "DISTURBING THE PEACE" bucket so the feed reads
    // as actual reported crime.
    .filter((f) => !NON_CRIME_LEGENDS.has((f.attributes.CMLegend ?? "").toUpperCase()))
    .map((f, i) => {
      const a = f.attributes;
      const lng = f.geometry && f.geometry.x !== 0 ? f.geometry.x : undefined;
      const lat = f.geometry && f.geometry.y !== 0 ? f.geometry.y : undefined;
      const nbhd = (lat != null && lng != null) ? geocodeAbq(lng, lat) : null;
      return {
        id: `abq-${a.OBJECTID ?? a.CallNumber ?? i}`,
        // ReportDateTime is a true epoch-ms UTC instant — use it directly.
        area: nbhd ?? "Unknown",
        occurredAt: new Date(a.ReportDateTime!).toISOString(),
        nibrsCategory: classify(a.CMLegend),
        ibrOffenseDescription: titleCaseOffense(a.CMLegend ?? "Unknown"),
        beat: null,
        blockLabel: a.BlockAddress ?? undefined,
        lat,
        lng,
      } as Incident;
    });
}

// In-flight fetch dedup: the dispatcher fans a per-area Promise.all over every
// neighbourhood, so a cold cache would otherwise fire N concurrent full fetches.
let inFlightFetch: Promise<Incident[]> | null = null;
export async function getRowsAlbuquerque(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightFetch) return inFlightFetch;
  inFlightFetch = (async () => {
    try {
      const rows = await fetchAlbuquerque();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[albuquerque] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightFetch = null;
    }
  })();
  return inFlightFetch;
}

export async function getDiscoveredAreasAlbuquerque(): Promise<KnownArea[]> {
  const rows = await getRowsAlbuquerque();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat;
    e.lngSum += r.lng;
    e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 3)
    .map(([name, e]) => ({
      slug: slugify(name),
      label: name,
      jurisdiction: "Albuquerque",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForSlug(slug: string, rows: Incident[]): string | null {
  const want = slug.toLowerCase();
  for (const r of rows) {
    if (slugify(r.area) === want) return r.area;
  }
  return null;
}

export const albuquerqueAdapter: CrimeDataAdapter = {
  name: "albuquerque-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsAlbuquerque();
    const label = labelForSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [40, 120, 250, 500]);
    return {
      area: label,
      crimeRate: null,
      violentCrimeRate: null,
      propertyCrimeRate: null,
      riskLevel,
      provenance: PROVENANCE,
    };
  },
  async getIncidents(area, opts) {
    const rows = await getRowsAlbuquerque();
    const label = labelForSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area, opts) {
    return this.getIncidents(area, { limit: opts?.limit ?? 20 });
  },
};
