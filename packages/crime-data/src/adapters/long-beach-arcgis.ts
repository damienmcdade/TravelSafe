import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";
import { longBeachPolygons } from "../data/long-beach-neighborhoods.js";

// Long Beach, CA — LBPD "Police Crime Mapping" ArcGIS FeatureServer.
// Incident-level NIBRS rows with point geometry; the city refreshes a
// rolling ~6-month window weekly (~11k rows). Rows carry a NIBRS "Type"
// bucket (CRIMES AGAINST PERSONS/PROPERTY/SOCIETY) and a NIBRS offense
// "Category"; we geocode each incident to one of 98 official Long Beach
// neighborhoods via point-in-polygon (LBPD division for the rare point
// outside every polygon).
// Source: https://services6.arcgis.com/yCArG7wGXGyWLqav/arcgis/rest/services/Police_Crime_Mapping/FeatureServer/0

const BASE = "https://services6.arcgis.com/yCArG7wGXGyWLqav/arcgis/rest/services/Police_Crime_Mapping/FeatureServer/0/query";
const PAGE_SIZE = 2000; // = server maxRecordCount
// Feed is a rolling ~6-month window of ~11k rows; 8 pages (16k) covers it
// fully with headroom as the window grows.
const PAGES = 8;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; }, "long-beach-arcgis");

interface LbFeature {
  attributes: {
    DR?: string;
    Category?: string;        // NIBRS offense, e.g. "AGGRAVATED ASSAULT"
    Type?: string;            // NIBRS bucket, e.g. "CRIMES AGAINST PERSONS"
    CrimeType?: string;
    ReportedDateTime?: string;
    ReportedDateTimeDate?: number; // epoch ms
    Division?: string;        // NORTH | EAST | SOUTH | WEST | PORT
    Beat?: string;
  };
  geometry?: { x: number; y: number };
}

function classify(category: string | undefined, type: string | undefined): CrimeCategory {
  const cat = (category ?? "").toUpperCase();
  // NIBRS files robbery under "Crimes Against Property", but the FBI UCR
  // counts it as a Part-1 VIOLENT offense. Force it to PERSONS so the
  // safety score's isPart1Violent filter picks it up (same fix as
  // Dallas / Pittsburgh / Saint Paul).
  if (cat.includes("ROBBERY")) return CrimeCategory.PERSONS;
  const t = (type ?? "").toUpperCase();
  if (t === "CRIMES AGAINST PERSONS") return CrimeCategory.PERSONS;
  if (t === "CRIMES AGAINST PROPERTY") return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// LBPD division fallback label for the ~6% of points outside every
// neighborhood polygon (port channels, rivers, parks, city edges).
// Clearly labeled as a division so it reads honestly, and excluded from
// neighborhood discovery below — those incidents still count citywide.
function divisionFallback(division: string | undefined): string {
  const d = (division ?? "").trim();
  if (!d) return "Unknown";
  const title = d.charAt(0).toUpperCase() + d.slice(1).toLowerCase();
  return `LBPD ${title} Division`;
}

// Point-in-polygon geocoder over the 98 official Long Beach neighborhoods.
// bbox-prefiltered ray casting — same self-contained pattern as the
// Indianapolis / Boston / Philadelphia adapters.
interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = longBeachPolygons.map((p) => {
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
function geocodeLongBeach(lng: number, lat: number): string | null {
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
  source: "Long Beach Police Department Crime Mapping (City of Long Beach ArcGIS)",
  datasetUrl: "https://www.longbeach.gov/police/crime-info/",
  recency: "Refreshed weekly by the Long Beach Police Department (rolling ~6-month window)",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Long Beach Police Department and geocoded to one of " +
    "98 official Long Beach neighborhoods (LBPD division for the rare point outside every " +
    "polygon) — not live, not street-level. CommunitySafe does not track individuals.",
};

async function fetchPage(offset: number): Promise<LbFeature[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "DR,Category,Type,CrimeType,ReportedDateTime,ReportedDateTimeDate,Division,Beat");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("orderByFields", "ReportedDateTimeDate DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Long Beach ArcGIS ${res.status} offset=${offset}`);
  const body = await res.json() as { features?: LbFeature[] };
  return body.features ?? [];
}

async function fetchLongBeach(): Promise<Incident[]> {
  const results: LbFeature[][] = new Array(PAGES);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PAGES) return;
      results[i] = await fetchPage(i * PAGE_SIZE).catch(() => [] as LbFeature[]);
    }
  });
  await Promise.all(workers);
  const feats = results.flat();
  return feats
    .filter((f) => typeof f.attributes.ReportedDateTimeDate === "number")
    .map((f, i) => {
      const a = f.attributes;
      const lng = f.geometry && f.geometry.x !== 0 ? f.geometry.x : undefined;
      const lat = f.geometry && f.geometry.y !== 0 ? f.geometry.y : undefined;
      const nbhd = (lat != null && lng != null) ? geocodeLongBeach(lng, lat) : null;
      const area = nbhd ?? divisionFallback(a.Division);
      return {
        id: `lb-${a.DR ?? i}`,
        area,
        occurredAt: new Date(a.ReportedDateTimeDate!).toISOString(),
        nibrsCategory: classify(a.Category, a.Type),
        ibrOffenseDescription: titleCaseOffense(a.Category ?? a.CrimeType ?? "Unknown"),
        beat: a.Beat ?? null,
        blockLabel: undefined,
        lat,
        lng,
      };
    });
}

// v107 — in-flight fetch dedup (the OOM-guard Detroit added in v94): the
// dispatcher fans a per-area Promise.all over every neighbourhood, so a cold
// cache previously fired N concurrent full fetches. Concurrent callers now
// await the same promise.
let inFlightLongBeachFetch: Promise<Incident[]> | null = null;
export async function getRowsLongBeach(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightLongBeachFetch) return inFlightLongBeachFetch;
  inFlightLongBeachFetch = (async () => {
    try {
      const rows = await fetchLongBeach();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[long-beach] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightLongBeachFetch = null;
    }
  })();
  return inFlightLongBeachFetch;
}

export async function getDiscoveredAreasLongBeach(): Promise<KnownArea[]> {
  const rows = await getRowsLongBeach();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    // Keep the catalog to real neighborhoods — the LBPD division fallback
    // labels still count citywide but aren't browsable pseudo-neighborhoods.
    if (/^LBPD .* Division$/.test(r.area)) continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat; e.lngSum += r.lng; e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 3)
    .map(([name, e]) => ({
      slug: `lb-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Long Beach",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForLongBeachSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("lb-") ? s.slice(3) : s;
  for (const r of rows) {
    const cand = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (cand === want) return r.area;
  }
  return null;
}

export const longBeachAdapter: CrimeDataAdapter = {
  name: "long-beach-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsLongBeach();
    const label = labelForLongBeachSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [40, 120, 250, 500]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },
  async getIncidents(area, opts) {
    const rows = await getRowsLongBeach();
    const label = labelForLongBeachSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area, opts) { return this.getIncidents(area, { limit: opts?.limit ?? 20 }); },
};
