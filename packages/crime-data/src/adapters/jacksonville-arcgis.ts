import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";
import { jacksonvillePolygons } from "../data/jacksonville-neighborhoods.js";

// Jacksonville, FL — Jacksonville Sheriff's Office (JSO) "NIBRS Incidents"
// ArcGIS FeatureServer (keyless, hosted on the City of Jacksonville org).
// Incident-level NIBRS rows carry point geometry, so we geocode each incident
// to one of 208 named Jacksonville/Duval neighborhoods (Riverside, Springfield,
// San Marco, Avondale, Mandarin, Arlington, Murray Hill, Ortega, …) via
// point-in-polygon — the companion polygon layer
// (apps/web/public/geo/jacksonville.geojson) is keyed on the same neighborhood
// names. Points outside every polygon → "Unmapped" (still counted citywide).
// The feed is JSO's live transparency set (refreshed daily; newest rows current
// through today). `IncidentDateTime` is an absolute epoch-ms instant, so
// `new Date(ms).toISOString()` is the correct conversion (no city-local
// wall-clock reinterpretation needed — Jacksonville is ET).
// Source: https://services3.arcgis.com/7C7xW0yv6W8spzhp/arcgis/rest/services/Public_Transparency_Data_View_10_03_2025/FeatureServer/0
// Neighborhoods: https://services8.arcgis.com/fz31a0BYuiNi04Ez/arcgis/rest/services/Neighborhoods_Jacksonville/FeatureServer/1

const BASE = "https://services3.arcgis.com/7C7xW0yv6W8spzhp/arcgis/rest/services/Public_Transparency_Data_View_10_03_2025/FeatureServer/0/query";
const PAGE_SIZE = 2000; // = server maxRecordCount
// The feed holds ~392k rows of history; we pull a rolling ~13-month window
// (date-filtered) for an accurate annualized rate. ~65k rows/yr ÷ 2000 ≈ 33
// pages; 40 pages (80k) covers the window with headroom.
const PAGES = 40;
const WINDOW_DAYS = 400;
const CACHE_TTL_MS = 5 * 60 * 1000;
// Discovery min-count: keeps the browsable catalog to neighborhoods with a
// real incident base. Every emitted neighborhood has a matching boundary
// polygon (its name is taken straight from the polygon layer via PIP).
const MIN_AREA_INCIDENTS = 10;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; }, "jacksonville-arcgis");

interface JsoFeature {
  attributes: {
    OBJECTID?: number;
    IncidentDateTime?: number; // epoch ms (absolute instant)
    nibrsDescription?: string; // offense, e.g. "AGGRAVATED ASSAULT", "THEFT"
    nibrsCode?: string;        // NIBRS code, e.g. "13A", "23X", "35X"
  };
  geometry?: { x: number; y: number };
}

// JSO's NIBRS vocabulary keyed by the standard NIBRS code prefix (most reliable
// signal), with a description-text fallback. Crimes against PERSONS: homicide
// (09*), kidnapping (100), forcible/non-forcible sex (11*, 36*), assault /
// intimidation / stalking (13*), human trafficking (64*), and robbery (120) —
// robbery is technically against property in NIBRS but the FBI/UCR counts it as
// violent, matching the Baltimore adapter's treatment. PROPERTY: arson (200),
// extortion (210), burglary (220), theft (23*), MV theft (240), forgery (250),
// fraud (26*), stolen property (280), vandalism (290). Everything else
// (drugs 35*, weapons 520, DUI/disorderly/etc. 90*, prostitution 40*, gambling
// 39*, animal cruelty 720, …) is SOCIETY.
function classify(code: string | undefined, description: string | undefined): CrimeCategory {
  const c = (code ?? "").toUpperCase();
  if (/^(09|100|11|13|36|64|120)/.test(c)) return CrimeCategory.PERSONS;
  if (/^(200|210|220|23|240|250|26|280|290)/.test(c)) return CrimeCategory.PROPERTY;
  if (c) return CrimeCategory.SOCIETY;
  // Description fallback for the rare row missing a code.
  const d = (description ?? "").toUpperCase();
  if (/HOMICIDE|MURDER|MANSLAUGHTER|RAPE|ASSAULT|ROBBERY|KIDNAP|INTIMIDATION|STALKING|SEX|TRAFFICKING/.test(d)) return CrimeCategory.PERSONS;
  if (/THEFT|BURGLARY|ARSON|VANDALISM|FRAUD|FORGERY|STOLEN|EXTORTION/.test(d)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// Point-in-polygon geocoder over the 208 named Jacksonville neighborhoods.
// bbox-prefiltered ray casting — same self-contained pattern as the
// Long Beach / Indianapolis / Boston / Philadelphia adapters.
interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = jacksonvillePolygons.map((p) => {
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
function geocodeJacksonville(lng: number, lat: number): string | null {
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
  source: "JSO NIBRS Incidents · Jacksonville Sheriff's Office (ArcGIS)",
  datasetUrl: "https://services3.arcgis.com/7C7xW0yv6W8spzhp/arcgis/rest/services/Public_Transparency_Data_View_10_03_2025/FeatureServer/0",
  recency: "Refreshed daily by the Jacksonville Sheriff's Office (rolling history)",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Jacksonville Sheriff's Office and geocoded to one of " +
    "208 named Jacksonville neighborhoods (\"Unmapped\" for the rare point outside every " +
    "polygon) — not live, not street-level. CommunitySafe does not track individuals.",
};

async function fetchPage(offset: number, sinceIso: string): Promise<JsoFeature[]> {
  const url = new URL(BASE);
  // Hosted FeatureServer date predicate uses the SQL DATE literal form
  // (verified against the live service; raw-epoch predicates are rejected).
  url.searchParams.set("where", `IncidentDateTime >= DATE '${sinceIso}'`);
  url.searchParams.set("outFields", "OBJECTID,IncidentDateTime,nibrsDescription,nibrsCode");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("orderByFields", "IncidentDateTime DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Jacksonville ArcGIS ${res.status} offset=${offset}`);
  const body = await res.json() as { features?: JsoFeature[]; error?: { message?: string } };
  if (body.error) throw new Error(`Jacksonville ArcGIS error: ${body.error.message}`);
  return body.features ?? [];
}

async function fetchJacksonville(): Promise<Incident[]> {
  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const results: JsoFeature[][] = new Array(PAGES);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PAGES) return;
      const page = await fetchPage(i * PAGE_SIZE, sinceIso).catch(() => [] as JsoFeature[]);
      results[i] = page;
      // Short-circuit: an empty page means we've run past the window.
      if (page.length === 0) return;
    }
  });
  await Promise.all(workers);
  const feats = results.flat();
  return feats
    .filter((f) => typeof f.attributes.IncidentDateTime === "number")
    .map((f, i) => {
      const a = f.attributes;
      const lng = f.geometry && f.geometry.x !== 0 ? f.geometry.x : undefined;
      const lat = f.geometry && f.geometry.y !== 0 ? f.geometry.y : undefined;
      const nbhd = (lat != null && lng != null) ? geocodeJacksonville(lng, lat) : null;
      return {
        id: `jax-${a.OBJECTID ?? i}`,
        area: nbhd ?? "Unmapped",
        occurredAt: new Date(a.IncidentDateTime!).toISOString(),
        nibrsCategory: classify(a.nibrsCode, a.nibrsDescription),
        ibrOffenseDescription: titleCaseOffense(a.nibrsDescription ?? "Unknown"),
        beat: null,
        blockLabel: undefined,
        lat,
        lng,
      };
    });
}

export async function getRowsJacksonville(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchJacksonville();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[jacksonville] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

// Area label is the neighborhood name; slug = "jax-<name>" (unique prefix). The
// boundary geojson sets properties.name to the same neighborhood name so the
// Crime Map's normName() compare lines up.
function slugify(name: string): string {
  return `jax-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export async function getDiscoveredAreasJacksonville(): Promise<KnownArea[]> {
  const rows = await getRowsJacksonville();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || r.area === "Unmapped") continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat; e.lngSum += r.lng; e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= MIN_AREA_INCIDENTS)
    .map(([name, e]) => ({
      slug: slugify(name),
      label: name,
      jurisdiction: "Jacksonville",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForJacksonvilleSlug(slug: string, rows: Incident[]): string | null {
  const want = slug.toLowerCase();
  for (const r of rows) {
    if (r.area === "Unmapped") continue;
    if (slugify(r.area) === want) return r.area;
  }
  return null;
}

export const jacksonvilleAdapter: CrimeDataAdapter = {
  name: "jacksonville-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsJacksonville();
    const label = labelForJacksonvilleSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [60, 180, 400, 800]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },
  async getIncidents(area, opts) {
    const rows = await getRowsJacksonville();
    const label = labelForJacksonvilleSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area, opts) { return this.getIncidents(area, { limit: opts?.limit ?? 20 }); },
};
