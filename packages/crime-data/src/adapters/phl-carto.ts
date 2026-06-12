import { CrimeCategory } from "../crime-category.js";
import { readJson } from "../lib/http.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { phlPolygons } from "../data/phl-neighborhoods.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";

// Philadelphia — Crime Incidents Part 1 & Part 2 (PPD).
// CARTO SQL API at phl.carto.com — third adapter shape after Socrata and
// ArcGIS. CARTO accepts a custom SQL string in the URL `q=` parameter and
// returns rows in `result.rows`, ordered as the SQL specifies.
// Doc: https://www.opendataphilly.org/dataset/crime-incidents

const BASE = "https://phl.carto.com/api/v2/sql";
const TABLE = "incidents_part1_part2";
// Philly publishes ~415 Part-1 + Part-2 incidents per day. The
// original 5k limit spanned ~12 days of cached activity;
// safety-score's 365-day annualization gave a ~30× multiplier that
// made every refresh swing the citywide rate by tens of percent.
// 30k rows covers ~75 days — past the 30-day "low confidence"
// trip-wire and stable across cache cycles. CARTO SQL accepts
// larger LIMITs but 30k is comfortable; raising further has
// diminishing returns vs the request payload size.
const ROW_LIMIT = 30_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; }, "phl-carto");

interface PhlRow {
  objectid?: number;
  dc_dist?: string | null;        // "09", "19", "25" (zero-padded)
  text_general_code?: string | null;
  dispatch_date_time?: string | null;
  point_x?: number | null;        // longitude (CARTO uses x = lng)
  point_y?: number | null;        // latitude
  location_block?: string | null;
  psa?: string | null;
}

const PERSONS_KEYWORDS = [
  "ASSAULT", "ROBBERY", "HOMICIDE", "MURDER", "RAPE", "SEX",
  "HARASSMENT", "STALKING", "KIDNAP", "THREATS",
];
const PROPERTY_KEYWORDS = [
  "THEFT", "BURGLARY", "ARSON", "VANDALISM", "FRAUD",
  "FORGERY", "TRESPASS", "RECEIVING STOLEN", "STOLEN",
];
function mapToNibrs(row: PhlRow): CrimeCategory {
  const t = (row.text_general_code ?? "").toUpperCase();
  if (PERSONS_KEYWORDS.some((k) => t.includes(k))) return CrimeCategory.PERSONS;
  if (PROPERTY_KEYWORDS.some((k) => t.includes(k))) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// FALLBACK ONLY (since the neighborhood geocoder below): PPD's 21 police
// districts mapped to the single most-recognized neighborhood name in
// each district's service area. Used for the rare incident with no
// usable point_x/point_y, or one that lands outside every neighborhood
// polygon. Where two districts cover similar geography, we differentiate
// by picking distinct anchor neighborhoods (5 vs 7 vs 8 vs 15 — all
// "Northeast" — get Frankford / Bustleton / Somerton / Tacony).
const DISTRICT_NEIGHBORHOODS: Record<number, string> = {
  1:  "South Philadelphia",
  2:  "Mayfair",
  3:  "Pennsport",
  5:  "Frankford",
  7:  "Bustleton",
  8:  "Somerton",
  9:  "Center City",
  12: "Eastwick",
  14: "Germantown",
  15: "Tacony",
  16: "Mantua",
  17: "Point Breeze",
  18: "Cobbs Creek",
  19: "University City",
  22: "Brewerytown",
  24: "Kensington",
  25: "Hunting Park",
  26: "Fishtown",
  35: "Olney",
  39: "East Falls",
  77: "Citywide",
};

function enrich(dc_dist: string | null | undefined): string {
  if (!dc_dist) return "Unknown";
  const n = parseInt(dc_dist, 10);
  if (!Number.isFinite(n)) return "Unknown";
  // Drop the district-number prefix per v10 directive — surface
  // the real neighborhood name only. Fall back to "PPD District N"
  // for any number we haven't mapped yet so unknown districts
  // remain identifiable instead of all collapsing to "Unknown".
  return DISTRICT_NEIGHBORHOODS[n] ?? `PPD District ${n}`;
}

// Point-in-polygon neighborhood geocoder over the 158 OpenDataPhilly
// neighborhoods. bbox-prefiltered ray casting — same self-contained
// pattern as the New Orleans adapter (no shared dep). Built once at
// module load.
interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = phlPolygons.map((p) => {
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

function geocodePhl(lng: number, lat: number): string | null {
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
  source: "Philadelphia Crime Incidents Part 1 & Part 2 (OpenDataPhilly, CARTO SQL)",
  datasetUrl: "https://opendataphilly.org/datasets/crime-incidents/",
  recency: "Refreshed daily by the Philadelphia Police Department",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Philadelphia Police Department and " +
    "geocoded to one of 158 OpenDataPhilly neighborhoods — not live, not " +
    "street-level. CommunitySafe does not track individuals.",
};

async function fetchPhl(): Promise<Incident[]> {
  const sql = `SELECT objectid,dc_dist,text_general_code,dispatch_date_time,point_x,point_y,location_block,psa FROM ${TABLE} WHERE dispatch_date_time IS NOT NULL ORDER BY dispatch_date_time DESC LIMIT ${ROW_LIMIT}`;
  // POST the SQL rather than encoding it into the URL. CARTO's openresty
  // gateway rejects GETs whose request line is too long with an HTML 400
  // — at LIMIT 30k the encoded query crosses that ceiling and every
  // build was logging "[phl] fetch failed: PHL CARTO 400". POST has no
  // such limit, and the API contract is the same either way.
  const formBody = new URLSearchParams({ q: sql }).toString();
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 CommunitySafe/0.1 (https://github.com/damienmcdade/TravelSafe)",
    },
    body: formBody,
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`PHL CARTO ${res.status}`);
  const body = await readJson(res) as { rows?: PhlRow[]; error?: unknown };
  if (body.error) throw new Error(`PHL CARTO error: ${JSON.stringify(body.error)}`);
  const rows = body.rows ?? [];
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // fix(audit loc-phl-epoch-fallback-3): DROP a row with no parseable dispatch
    // time instead of stamping it epoch(0). An epoch-0 occurredAt poisons the
    // citywide rate window (collapses windowDays toward 365 from 1970) and dates
    // the incident to 1970 on the map. The SQL already filters NULLs, so this is
    // the belt-and-suspenders for blank / unparseable strings.
    // fix(audit data-sev2 tz): dispatch_date_time is Eastern wall-clock with no
    // zone marker; `new Date()` parsed it as server-local (UTC), shifting every
    // Philadelphia incident 4–5h (wrong time-of-day, "Xh ago", and since-filter
    // membership). Route through cityLocalToUtcIso (DST-aware; trusts an
    // already-zoned string, so it's safe if the feed ever adds an offset).
    const iso = cityLocalToUtcIso(r.dispatch_date_time, "America/New_York");
    const ts = +new Date(iso);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    // CARTO returns point_x = lng, point_y = lat (the GIS XY convention).
    const lng = typeof r.point_x === "number" ? r.point_x : undefined;
    const lat = typeof r.point_y === "number" ? r.point_y : undefined;
    const hasCoord = typeof lat === "number" && lat !== 0 && typeof lng === "number" && lng !== 0;
    // Prefer the neighborhood the incident's point falls inside; fall
    // back to the PPD-district anchor for rows with no/zeroed point or
    // that land outside every polygon.
    const area = (hasCoord ? geocodePhl(lng!, lat!) : null) ?? enrich(r.dc_dist);
    out.push({
      id: `phl-${r.objectid ?? i}`,
      area,
      occurredAt: iso,
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.text_general_code?.trim() || "Unknown",
      beat: r.psa ?? null,
      blockLabel: r.location_block ?? undefined,
      lat: hasCoord ? lat : undefined,
      lng: hasCoord ? lng : undefined,
    });
  }
  return out;
}

// v107 — in-flight fetch dedup (the OOM-guard Detroit added in v94): the
// dispatcher fans a per-area Promise.all over every neighbourhood, so a cold
// cache previously fired N concurrent full fetches. Concurrent callers now
// await the same promise.
let inFlightPhlFetch: Promise<Incident[]> | null = null;
export async function getRowsPhl(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightPhlFetch) return inFlightPhlFetch;
  inFlightPhlFetch = (async () => {
    try {
      const rows = await fetchPhl();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[phl] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightPhlFetch = null;
    }
  })();
  return inFlightPhlFetch;
}

export async function getDiscoveredAreasPhl(): Promise<KnownArea[]> {
  const rows = await getRowsPhl();
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
      // Slug from the normalized neighborhood name — must match the
      // normalization in labelForPhlSlug for round-tripping.
      slug: `phl-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Philadelphia",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForPhlSlug(slug: string, rows: Incident[]): string | null {
  // v10 mapped PPD district numbers to neighborhood names ("Center City",
  // "Mayfair", etc.) and discovery now produces string slugs ("phl-
  // center-city") rather than numeric ones ("phl-9"). The prior matcher
  // here still expected a numeric tail and returned null for every
  // string slug, which made getAreaStats return null for every
  // neighborhood and the citywide endpoint show 0 incidents per area
  // despite 30k cached rows. Match by normalized-label string instead
  // (same pattern as the Pittsburgh/Buffalo/Norfolk adapters).
  const s = slug.toLowerCase();
  const want = s.startsWith("phl-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const phlAdapter: CrimeDataAdapter = {
  name: "phl-carto",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsPhl();
    const label = labelForPhlSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [60, 180, 350, 600]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsPhl();
    const label = labelForPhlSlug(area, rows);
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
