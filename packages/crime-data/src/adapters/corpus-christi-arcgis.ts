import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT, readJson, fetchWithRetry } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";
import { corpusChristiPolygons } from "../data/corpus-christi-neighborhoods.js";

// Corpus Christi, TX — Corpus Christi Police Department crime-dashboard
// service (on-prem CCPD MapServer). Incident-level point rows with an
// `offense_date` (epoch ms, hour-level), an offense `type` bucket, and a
// free-text `description`. The feed carries NO in-row neighborhood and no
// sector/district field (agency is always "CCPD"), so we geocode each
// incident to one of the City of Corpus Christi's 9 official Area Development
// Plan (ADP) planning districts via point-in-polygon. ~99.5% of incidents
// fall inside one; the rare outsider (bay water, city edges) is labeled
// "CCPD (outside planning areas)" and still counts citywide.
// Crime source: https://ccpublicgis.cctexas.com/server01/rest/services/CCPD/CCPD_CRIME_DASH_SV/MapServer/0
// Boundary source: https://services.arcgis.com/0J4ZNc4NaTguvRy0/arcgis/rest/services/OpenData/FeatureServer/33 (DISTRICT)

const BASE =
  "https://ccpublicgis.cctexas.com/server01/rest/services/CCPD/CCPD_CRIME_DASH_SV/MapServer/0/query";
const PAGE_SIZE = 5000; // well under the server maxRecordCount (15000)
const WINDOW_DAYS = 400; // covers the 365d score window; feed itself is a rolling ~6-month window
const PAGES = 6; // feed is ~6k rows total → 6 pages (30k) has comfortable headroom
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => {
  cache = null;
}, "corpus-christi-arcgis");

interface CcFeature {
  attributes: {
    OBJECTID?: number;
    offense_date?: number; // epoch ms, hour-level
    event_num?: string;
    type?: string; // offense bucket, e.g. "ASSAULT", "THEFT FROM VEHIC"
    description?: string; // free-text offense, e.g. "AGG ASSAULT W/DEADLY WEAPON"
    address?: string;
  };
  geometry?: { x: number; y: number }; // x=lng, y=lat (WGS84 when outSR=4326)
}

// CCPD `type` → CommunitySafe bucket (Crimes Against Persons / Property /
// Society). Robbery is filed by NIBRS under Property but the FBI UCR counts
// it as a Part-1 VIOLENT offense, so force it to PERSONS (same convention as
// the Long Beach / Dallas / Saint Paul adapters). Observed distinct `type`
// values: ROBBERY, SEXUAL ASSAULT, ASSAULT, THEFT, THEFT OF A MOTOR,
// THEFT FROM VEHIC, BURGLARY.
function classify(type: string | undefined): CrimeCategory {
  const t = (type ?? "").toUpperCase();
  if (t.includes("ROBBERY")) return CrimeCategory.PERSONS;
  if (
    t.includes("ASSAULT") ||
    t.includes("HOMICIDE") ||
    t.includes("MURDER") ||
    t.includes("RAPE") ||
    t.includes("SEX") ||
    t.includes("KIDNAP")
  ) {
    return CrimeCategory.PERSONS;
  }
  if (
    t.includes("BURGLARY") ||
    t.includes("THEFT") ||
    t.includes("LARCENY") ||
    t.includes("VEHIC") ||
    t.includes("AUTO") ||
    t.includes("MOTOR") ||
    t.includes("ARSON") ||
    t.includes("VANDAL") ||
    t.includes("FRAUD")
  ) {
    return CrimeCategory.PROPERTY;
  }
  return CrimeCategory.SOCIETY;
}

// Fallback label for the ~0.5% of points outside every ADP planning area
// (bay/ship-channel water, city edges). Clearly labeled so it reads honestly,
// and excluded from neighborhood discovery below — these still count citywide.
const FALLBACK_LABEL = "CCPD (outside planning areas)";

// Point-in-polygon geocoder over the 9 official Corpus Christi ADP planning
// districts. bbox-prefiltered ray casting — same self-contained pattern as the
// Long Beach / Indianapolis / Boston adapters.
interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = corpusChristiPolygons.map((p) => {
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
function geocodeCorpusChristi(lng: number, lat: number): string | null {
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
  source: "Corpus Christi Police Department (City of Corpus Christi GIS)",
  datasetUrl: "https://www.cctexas.com/departments/police",
  recency: "Refreshed by the Corpus Christi Police Department (rolling ~6-month incident feed)",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Corpus Christi Police Department and geocoded to one of " +
    "9 official City of Corpus Christi planning districts (a catch-all label for the rare " +
    "point outside every district) — not live, not street-level. CommunitySafe does not track individuals.",
};

function slugifyArea(name: string): string {
  return `cc-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

async function fetchPage(offset: number, sinceTs: string): Promise<CcFeature[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", `offense_date >= timestamp '${sinceTs}'`);
  url.searchParams.set("outFields", "OBJECTID,offense_date,event_num,type,description,address");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("orderByFields", "offense_date DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Corpus Christi ArcGIS ${res.status} offset=${offset}`);
  const body = (await readJson(res)) as { features?: CcFeature[]; error?: unknown };
  // Throw on the embedded ArcGIS error envelope (HTTP 200 + {error:{...}}) so a
  // token-gated/failed layer serves last-known-good instead of grading as zero-crime.
  if (body.error) throw new Error(`Corpus Christi ArcGIS body error offset=${offset}`);
  return body.features ?? [];
}

async function fetchCorpusChristi(): Promise<Incident[]> {
  const sinceTs = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  const results: CcFeature[][] = new Array(PAGES);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PAGES) return;
      results[i] = await fetchPage(i * PAGE_SIZE, sinceTs).catch(() => [] as CcFeature[]);
    }
  });
  await Promise.all(workers);
  const feats = results.flat();
  return feats
    .filter((f) => typeof f.attributes.offense_date === "number")
    .map((f, i) => {
      const a = f.attributes;
      const lng = f.geometry && f.geometry.x !== 0 ? f.geometry.x : undefined;
      const lat = f.geometry && f.geometry.y !== 0 ? f.geometry.y : undefined;
      const nbhd = (lat != null && lng != null) ? geocodeCorpusChristi(lng, lat) : null;
      const area = nbhd ?? FALLBACK_LABEL;
      return {
        id: `cc-${a.event_num ?? a.OBJECTID ?? i}`,
        area,
        // offense_date is epoch ms (UTC-anchored instant) → toISOString directly.
        occurredAt: new Date(a.offense_date!).toISOString(),
        nibrsCategory: classify(a.type),
        ibrOffenseDescription: titleCaseOffense(a.description ?? a.type ?? "Unknown"),
        beat: null,
        blockLabel: undefined,
        lat,
        lng,
      } as Incident;
    });
}

// In-flight fetch dedup: the dispatcher fans a per-area Promise.all over every
// neighbourhood, so a cold cache would otherwise fire N concurrent full fetches.
let inFlightFetch: Promise<Incident[]> | null = null;
export async function getRowsCorpusChristi(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightFetch) return inFlightFetch;
  inFlightFetch = (async () => {
    try {
      const rows = await fetchCorpusChristi();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[corpus-christi] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightFetch = null;
    }
  })();
  return inFlightFetch;
}

export async function getDiscoveredAreasCorpusChristi(): Promise<KnownArea[]> {
  const rows = await getRowsCorpusChristi();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    // Keep the catalog to real planning districts — the catch-all label still
    // counts citywide but is not a browsable pseudo-neighborhood.
    if (r.area === FALLBACK_LABEL) continue;
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
      slug: slugifyArea(name),
      label: name,
      jurisdiction: "Corpus Christi",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForSlug(slug: string, rows: Incident[]): string | null {
  const want = slug.toLowerCase();
  for (const r of rows) {
    if (slugifyArea(r.area) === want) return r.area;
  }
  return null;
}

export const corpusChristiAdapter: CrimeDataAdapter = {
  name: "corpus-christi-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsCorpusChristi();
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
    const rows = await getRowsCorpusChristi();
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
