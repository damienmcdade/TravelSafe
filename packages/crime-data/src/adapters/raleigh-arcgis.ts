import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT, readJson, fetchWithRetry } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";
import { raleighPolygons } from "../data/raleigh-neighborhoods.js";

// Raleigh, NC — Raleigh Police Department "Police Incidents" ArcGIS
// FeatureServer. Incident-level rows with real WGS84 lat/lng fields
// (`latitude` / `longitude`, NOT geometry-only), a free-text crime bucket
// (`crime_category`, e.g. "AGGRAVATED ASSAULT"), an offense description
// (`crime_description`), the RPD police district (`district`, six patrol
// districts: Southeast / North / Northeast / Southwest / Downtown /
// Northwest — kept only as the fallback label), and a full timestamp
// (`reported_date`, epoch ms — verified to agree with `reported_hour` to the
// hour, so it is the real wall-clock time of report, not a date-only
// midnight). We geocode each incident to one of the 18 city-published
// Raleigh Citizens Advisory Council (CAC) areas via point-in-polygon —
// recognizable named areas (Five Points, Mordecai, Glenwood,
// Hillsborough-Wade, Midtown, North Central, …) instead of the generic
// compass patrol districts. The RPD district is the fallback label only for
// the rare point outside every CAC polygon.
//
// CRITICAL: a large share of rows are null-island (latitude=0 / null —
// ~37.5% across the full archive, ~25% of 2026). We filter `latitude<>0`
// in the where clause AND defensively in code so those rows never grade as
// a real (0,0) incident or pollute district centroids.
// Source: https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Police_Incidents/FeatureServer/0

const BASE =
  "https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Police_Incidents/FeatureServer/0/query";
const PAGE_SIZE = 5000; // = server maxRecordCount
const WINDOW_DAYS = 400; // a touch over a year so the 365d score window is fully covered
const PAGES = 10; // ~36k rows/400d (lat<>0) observed → 10 pages (50k) has comfortable headroom
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => {
  cache = null;
}, "raleigh-arcgis");

interface RaleighFeature {
  attributes: {
    OBJECTID?: number;
    case_number?: string;
    crime_category?: string; // e.g. "AGGRAVATED ASSAULT"
    crime_description?: string; // e.g. "Assault/Aggravated"
    reported_date?: number; // epoch ms, full timestamp
    reported_hour?: number; // hour of day 0-23 (agrees with reported_date)
    district?: string; // RPD police district (already title-cased)
    reported_block_address?: string;
    latitude?: number;
    longitude?: number;
  };
}

// crime_category → CommunitySafe bucket (Crimes Against Persons / Property /
// Society). Raleigh's `crime_category` is a single free-text bucket. Robbery
// is filed by NIBRS under Property but the FBI UCR counts it as a Part-1
// VIOLENT offense, so force it to PERSONS (same convention as the
// Long Beach / Dallas / Saint Paul / Dayton adapters).
function classify(category: string | undefined): CrimeCategory {
  const c = (category ?? "").toUpperCase();
  if (c.includes("ROBBERY")) return CrimeCategory.PERSONS;
  if (
    c.includes("ASSAULT") ||
    c.includes("MURDER") ||
    c.includes("HOMICIDE") ||
    c.includes("MANSLAUGHTER") ||
    c.includes("KIDNAPPING") ||
    c.includes("ABDUCTION") ||
    c.includes("SEX OFFENSE") ||
    c.includes("SEX OFFENSES") ||
    c.includes("INTIMIDATION") ||
    c.includes("HUMAN TRAFFICKING")
  ) {
    return CrimeCategory.PERSONS;
  }
  if (
    c.includes("BURGLARY") ||
    c.includes("LARCENY") ||
    c.includes("THEFT") ||
    c.includes("MV THEFT") ||
    c.includes("MOTOR VEHICLE") ||
    c.includes("UNAUTHORIZED MOTOR VEHICLE") ||
    c.includes("ARSON") ||
    c.includes("VANDALISM") ||
    c.includes("DAMAGE") ||
    c.includes("FRAUD") ||
    c.includes("FORGERY") ||
    c.includes("COUNTERFEIT") ||
    c.includes("EMBEZZLEMENT") ||
    c.includes("EXTORTION") ||
    c.includes("STOLEN PROPERTY")
  ) {
    return CrimeCategory.PROPERTY;
  }
  return CrimeCategory.SOCIETY;
}

// Districts come back already title-cased ("Southeast", "Downtown", …) — we
// just trim and normalize any stray casing so the fallback label is stable.
function titleCaseDistrict(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

// RPD-district fallback label for the rare point outside every CAC polygon
// (city edges, water, geocode noise). Clearly reads as a patrol district so
// it's honest, and excluded from CAC discovery below — those rows still
// count citywide. Blank/unknown districts collapse to "Unknown".
function districtFallback(district: string | undefined): string {
  const d = (district ?? "").trim();
  if (!d) return "Unknown";
  return `RPD ${titleCaseDistrict(d)} District`;
}

// Rows that fell back to a patrol district (or Unknown) still count citywide
// but aren't a browsable CAC area, so they're excluded from discovery.
const NON_NEIGHBORHOOD = (area: string): boolean =>
  area === "Unknown" || area === "" || /^RPD .* District$/.test(area);

function slugifyArea(name: string): string {
  return `ral-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

// Point-in-polygon geocoder over the 18 official Raleigh CAC areas.
// bbox-prefiltered ray casting — same self-contained pattern as the
// Long Beach / Indianapolis / Boston / Philadelphia adapters.
interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = raleighPolygons.map((p) => {
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
function geocodeRaleigh(lng: number, lat: number): string | null {
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
  source: "Raleigh Police Department (City of Raleigh Open Data ArcGIS)",
  datasetUrl: "https://data-ral.opendata.arcgis.com/",
  recency: "Refreshed daily by the Raleigh Police Department (rolling incident feed)",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Raleigh Police Department and geocoded to one of 18 " +
    "official Raleigh Citizens Advisory Council (CAC) areas (RPD patrol district for the " +
    "rare point outside every CAC polygon) — not live, not street-level. CommunitySafe " +
    "does not track individuals.",
};

async function fetchPage(offset: number, sinceTs: string): Promise<RaleighFeature[]> {
  const url = new URL(BASE);
  // Always AND latitude<>0 so null-island rows never page in.
  url.searchParams.set(
    "where",
    `latitude <> 0 AND latitude IS NOT NULL AND reported_date >= timestamp '${sinceTs}'`,
  );
  url.searchParams.set(
    "outFields",
    "OBJECTID,case_number,crime_category,crime_description,reported_date,reported_hour,district,reported_block_address,latitude,longitude",
  );
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "reported_date DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Raleigh ArcGIS ${res.status} offset=${offset}`);
  const body = (await readJson(res)) as { features?: RaleighFeature[]; error?: unknown };
  // Throw on the embedded ArcGIS error envelope (HTTP 200 + {error:{...}}) so a
  // token-gated/failed layer serves last-known-good instead of grading as zero-crime.
  if (body.error) throw new Error(`Raleigh ArcGIS body error offset=${offset}`);
  return body.features ?? [];
}

async function fetchRaleigh(): Promise<Incident[]> {
  const sinceTs = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  const results: RaleighFeature[][] = new Array(PAGES);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PAGES) return;
      results[i] = await fetchPage(i * PAGE_SIZE, sinceTs).catch(() => [] as RaleighFeature[]);
    }
  });
  await Promise.all(workers);
  const feats = results.flat();
  return feats
    .filter((f) => {
      const a = f.attributes;
      // Defensive null-island + date guard (mirrors the where clause). We no
      // longer require a non-blank district — a blank-district row with a real
      // lat/lng still geocodes to a CAC via point-in-polygon (and falls back
      // to "Unknown" only if it lands outside every CAC polygon).
      return (
        typeof a.reported_date === "number" &&
        typeof a.latitude === "number" &&
        a.latitude !== 0
      );
    })
    .map((f, i) => {
      const a = f.attributes;
      const lat = a.latitude;
      const lng = typeof a.longitude === "number" && a.longitude !== 0 ? a.longitude : undefined;
      const cac = lat != null && lng != null ? geocodeRaleigh(lng, lat) : null;
      return {
        id: `ral-${a.case_number ?? a.OBJECTID ?? i}`,
        area: cac ?? districtFallback(a.district),
        // reported_date is a real epoch-ms timestamp (verified to agree with
        // reported_hour), so use it directly — no local-midnight reconstruction.
        occurredAt: new Date(a.reported_date!).toISOString(),
        nibrsCategory: classify(a.crime_category),
        ibrOffenseDescription: titleCaseOffense(a.crime_description ?? a.crime_category ?? "Unknown"),
        beat: null,
        blockLabel: undefined,
        lat,
        lng,
      } as Incident;
    });
}

// In-flight fetch dedup: the dispatcher fans a per-area Promise.all over every
// district, so a cold cache would otherwise fire N concurrent full fetches.
let inFlightFetch: Promise<Incident[]> | null = null;
export async function getRowsRaleigh(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightFetch) return inFlightFetch;
  inFlightFetch = (async () => {
    try {
      const rows = await fetchRaleigh();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[raleigh] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightFetch = null;
    }
  })();
  return inFlightFetch;
}

export async function getDiscoveredAreasRaleigh(): Promise<KnownArea[]> {
  const rows = await getRowsRaleigh();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || NON_NEIGHBORHOOD(r.area)) continue;
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
      jurisdiction: "Raleigh",
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

export const raleighAdapter: CrimeDataAdapter = {
  name: "raleigh-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsRaleigh();
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
    const rows = await getRowsRaleigh();
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
