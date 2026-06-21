import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT, readJson, fetchWithRetry } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";
import { grandRapidsPolygons } from "../data/grand-rapids-neighborhoods.js";

// Grand Rapids, MI — Grand Rapids Police Department (GRPD) incident feed on the
// City of Grand Rapids ArcGIS Online org. The geocoded layer ("Sheet2_Geocoded3",
// service name CRIME_DALLLLLLL) is incident-level with point geometry already in
// WGS84 (x=lng / y=lat, also mirrored in the X/Y fields), a NIBRS category
// (`USER_NIBRS_Category` = "Crimes Against Person/Property/Society"), the NIBRS
// offense group (`USER_NIBRS_GRP`, which carries "Robbery" — see classify), the
// GRPD service area (`USER_Service_Area` = North/South/East/West/Central) and an
// offense datetime (`USER_DATEOFOFFENSE`, epoch-ms UTC with a REAL time of day,
// not a midnight-truncated date — verified live). We geocode each incident's
// lng/lat to one of the 40 OFFICIAL named City of Grand Rapids neighborhoods
// (Heritage Hill, Eastown, Creston, Alger Heights, Garfield Park, Baxter,
// Midtown…) via point-in-polygon, falling back to the GRPD service area for the
// rare point outside every polygon. ~60k rows / 400 days.
// Crime source: https://services2.arcgis.com/L81TiOwAPO1ZvU9b/arcgis/rest/services/CRIME_DALLLLLLL/FeatureServer/0
// Neighborhood polygons: https://services2.arcgis.com/L81TiOwAPO1ZvU9b/arcgis/rest/services/City_of_Grand_Rapids_Neighborhood_Areas/FeatureServer/0 (NEBRH name field)

const BASE =
  "https://services2.arcgis.com/L81TiOwAPO1ZvU9b/arcgis/rest/services/CRIME_DALLLLLLL/FeatureServer/0/query";
const PAGE_SIZE = 2000; // = server maxRecordCount
const WINDOW_DAYS = 400; // a touch over a year so the 365d score window is fully covered
const PAGES = 36; // ~60k in-window rows observed → 36 pages (72k) has comfortable headroom

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => {
  cache = null;
}, "grand-rapids-arcgis");

interface GrandRapidsFeature {
  attributes: {
    ObjectID?: number;
    X?: number; // lng (WGS84)
    Y?: number; // lat (WGS84)
    USER_INCNUMBER?: string;
    USER_Beat__?: string; // "Beat #" e.g. "N2"
    USER_Service_Area?: string; // North / South / East / West / Central
    USER_Offense_Description?: string;
    USER_NIBRS_Category?: string; // "Crimes Against Person/Property/Society"
    USER_NIBRS_GRP?: string; // NIBRS offense group, e.g. "Robbery", "Assault Offenses"
    USER_OFFENSETITLE?: string;
    USER_DATEOFOFFENSE?: number; // epoch ms UTC, with real time-of-day
    USER_BLOCK_ADDRESS__INCIDENT_LOCATIO?: string;
  };
  geometry?: { x: number; y: number }; // x=lng, y=lat (WGS84 when outSR=4326)
}

// NIBRS category → CommunitySafe bucket. The feed's `USER_NIBRS_Category` is
// already the NIBRS bucket ("Crimes Against Person/Property/Society"), but NIBRS
// files robbery under "Crimes Against Property" while the FBI UCR counts it as a
// Part-1 VIOLENT offense — so we force Robbery → PERSONS using the offense group
// (`USER_NIBRS_GRP` = "Robbery"). Same convention as the Long Beach / Dallas /
// Saint Paul / Dayton adapters. Non-crime field-contact rows carry category
// "Local"/"All Other"/"0" → SOCIETY (they don't tip violent/property counts).
function classify(category: string | undefined, grp: string | undefined): CrimeCategory {
  const g = (grp ?? "").toUpperCase();
  if (g.includes("ROBBERY")) return CrimeCategory.PERSONS;
  const cat = (category ?? "").toUpperCase();
  if (cat.includes("PERSON")) return CrimeCategory.PERSONS;
  if (cat.includes("PROPERTY")) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// GRPD service-area fallback label for the rare point outside every neighborhood
// polygon (river, parks, annexed edges, ~missing coords). Clearly labeled as a
// service area so it reads honestly, and excluded from neighborhood discovery
// below — those incidents still count citywide.
function serviceAreaFallback(name: string | undefined): string {
  const d = (name ?? "").trim();
  if (!d) return "Unknown";
  const title = d.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return `GRPD ${title}`;
}

// Point-in-polygon geocoder over the 40 official City of Grand Rapids
// neighborhoods. bbox-prefiltered ray casting — same self-contained pattern as
// the Long Beach / Indianapolis / Boston adapters.
interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = grandRapidsPolygons.map((p) => {
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
function geocodeGrandRapids(lng: number, lat: number): string | null {
  for (const p of POLY_INDEX) {
    const [minX, minY, maxX, maxY] = p.bbox;
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
    let parity = 0;
    for (const ring of p.rings) if (pointInRing(lng, lat, ring)) parity++;
    if (parity % 2 === 1) return p.name;
  }
  return null;
}

// Catch-all area labels that count citywide but are not browsable neighborhoods,
// so they're excluded from discovery. Matches "Unknown" and any "GRPD <area>".
function isNonArea(area: string): boolean {
  return !area || area === "Unknown" || /^GRPD\b/.test(area);
}

function slugifyArea(name: string): string {
  return `grr-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

const PROVENANCE: DataProvenance = {
  source: "Grand Rapids Police Department (City of Grand Rapids ArcGIS Open Data)",
  datasetUrl: "https://grandrapidsmi.gov/Services/Police",
  recency: "Refreshed regularly by the Grand Rapids Police Department (rolling NIBRS incident feed)",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Grand Rapids Police Department and geocoded to one of " +
    "40 official City of Grand Rapids neighborhoods (GRPD service area for the rare point " +
    "outside every polygon) — not live, not street-level. CommunitySafe does not track individuals.",
};

async function fetchPage(offset: number, sinceTs: string): Promise<GrandRapidsFeature[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", `USER_DATEOFOFFENSE >= timestamp '${sinceTs}'`);
  url.searchParams.set(
    "outFields",
    "ObjectID,X,Y,USER_INCNUMBER,USER_Beat__,USER_Service_Area,USER_Offense_Description,USER_NIBRS_Category,USER_NIBRS_GRP,USER_OFFENSETITLE,USER_DATEOFOFFENSE,USER_BLOCK_ADDRESS__INCIDENT_LOCATIO",
  );
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("orderByFields", "USER_DATEOFOFFENSE DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Grand Rapids ArcGIS ${res.status} offset=${offset}`);
  const body = (await readJson(res)) as { features?: GrandRapidsFeature[]; error?: unknown };
  // Throw on the embedded ArcGIS error envelope (HTTP 200 + {error:{...}}) so a
  // token-gated/failed layer serves last-known-good instead of grading as zero-crime.
  if (body.error) throw new Error(`Grand Rapids ArcGIS body error offset=${offset}`);
  return body.features ?? [];
}

async function fetchGrandRapids(): Promise<Incident[]> {
  const sinceTs = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  const results: GrandRapidsFeature[][] = new Array(PAGES);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PAGES) return;
      results[i] = await fetchPage(i * PAGE_SIZE, sinceTs).catch(() => [] as GrandRapidsFeature[]);
    }
  });
  await Promise.all(workers);
  const feats = results.flat();
  return feats
    .filter((f) => typeof f.attributes.USER_DATEOFOFFENSE === "number")
    .map((f, i) => {
      const a = f.attributes;
      // Geometry (outSR=4326) is authoritative; fall back to the X/Y fields.
      const rawLng = f.geometry && f.geometry.x !== 0 ? f.geometry.x : a.X;
      const rawLat = f.geometry && f.geometry.y !== 0 ? f.geometry.y : a.Y;
      const lng = typeof rawLng === "number" && rawLng !== 0 ? rawLng : undefined;
      const lat = typeof rawLat === "number" && rawLat !== 0 ? rawLat : undefined;
      // Geocode lng/lat to an official GR neighborhood; fall back to the GRPD
      // service area for the rare point outside every polygon (or missing coords).
      const nbhd = lat != null && lng != null ? geocodeGrandRapids(lng, lat) : null;
      const area = nbhd ?? serviceAreaFallback(a.USER_Service_Area);
      // USER_DATEOFOFFENSE is epoch-ms UTC with a real time of day — use it directly.
      const occurredAt = new Date(a.USER_DATEOFOFFENSE as number).toISOString();
      return {
        id: `grr-${a.ObjectID ?? i}`,
        area,
        occurredAt,
        nibrsCategory: classify(a.USER_NIBRS_Category, a.USER_NIBRS_GRP),
        ibrOffenseDescription: titleCaseOffense(
          a.USER_Offense_Description || a.USER_OFFENSETITLE || a.USER_NIBRS_GRP || "Unknown",
        ),
        beat: a.USER_Beat__ ?? null,
        blockLabel: a.USER_BLOCK_ADDRESS__INCIDENT_LOCATIO || undefined,
        lat,
        lng,
      } as Incident;
    });
}

// In-flight fetch dedup: the dispatcher fans a per-area Promise.all over every
// area, so a cold cache would otherwise fire N concurrent full fetches.
let inFlightFetch: Promise<Incident[]> | null = null;
export async function getRowsGrandRapids(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightFetch) return inFlightFetch;
  inFlightFetch = (async () => {
    try {
      const rows = await fetchGrandRapids();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[grand-rapids] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightFetch = null;
    }
  })();
  return inFlightFetch;
}

export async function getDiscoveredAreasGrandRapids(): Promise<KnownArea[]> {
  const rows = await getRowsGrandRapids();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (isNonArea(r.area)) continue;
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
      jurisdiction: "Grand Rapids",
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

export const grandRapidsAdapter: CrimeDataAdapter = {
  name: "grand-rapids-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsGrandRapids();
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
    const rows = await getRowsGrandRapids();
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
