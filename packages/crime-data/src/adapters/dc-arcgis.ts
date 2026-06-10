import { CrimeCategory } from "../crime-category.js";
import { readJson } from "../lib/http.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import dcGeo from "../data/dc-neighborhoods.json" with { type: "json" };

// Washington DC — MPD Crime Incidents.
// ArcGIS MapServer at maps2.dcgis.dc.gov, layer 39 (last 30 days). We
// geocode each incident's LATITUDE/LONGITUDE into one of DC's 51 official
// named neighborhoods (Health Planning Neighborhoods polygon set) via
// point-in-polygon at intake. The MPD-published NEIGHBORHOOD_CLUSTER
// field bundled multiple neighborhoods together — users complained they
// couldn't tell Adams Morgan from Kalorama Heights — so we ignore it now.
// Doc: https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/MPD/MapServer/39

// DC publishes crime incidents as year-specific ArcGIS layers under
// the FEEDS/MPD MapServer. Layer 39 = "Last 30 Days" — what we used
// originally — gives a too-small window for the safety-score's
// 365d annualization: 30 days of incidents annualized over an
// assumed-365d window deflated DC's per-100k by ~12×, falsely
// grading the entire city A. Pulling the per-year layers (41 =
// current, 7 = prior year) gives a real ~17-month rolling window;
// safety-score's wall-clock 365d filter then trims back to the
// canonical year correctly.
const BASE_TEMPLATE = "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/MPD/MapServer/{layer}/query";
// Layer IDs by year. Layer 41 is currently 2026 (the "current year"
// slot in DC's catalog); 7 is 2025. When the calendar turns over,
// DC rotates IDs so the year→layer map below needs updating —
// they typically post the new layer in early January.
const YEAR_LAYERS: Record<number, number> = {
  2026: 41,
  2025: 7,
  2024: 6,
};
const PAGE_SIZE = 2000;
// v26 bump 5 → 15. Sparser DC cache was under-counting both
// PERSONS and PROPERTY by ~2.5× vs FBI baseline; deeper cache
// gives the annualization a more representative window.
const PAGES = 15;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; }, "dc-mpd-arcgis");

interface DcRow {
  CCN?: string;
  OFFENSE?: string;
  METHOD?: string;
  START_DATE?: number;
  WARD?: string;
  DISTRICT?: string;
  LATITUDE?: number;
  LONGITUDE?: number;
}

const PERSONS_OFFENSES = new Set([
  "HOMICIDE", "ASSAULT W/DANGEROUS WEAPON", "ROBBERY", "SEX ABUSE",
]);
const PROPERTY_OFFENSES = new Set([
  "THEFT/OTHER", "THEFT F/AUTO", "MOTOR VEHICLE THEFT", "BURGLARY", "ARSON",
]);
function mapToNibrs(row: DcRow): CrimeCategory {
  const o = (row.OFFENSE ?? "").trim().toUpperCase();
  if (PERSONS_OFFENSES.has(o)) return CrimeCategory.PERSONS;
  if (PROPERTY_OFFENSES.has(o)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// ---- Point-in-polygon geocoding ---------------------------------------------

interface DCPolygon { name: string; geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] } }
const POLYS = (dcGeo as { polygons: DCPolygon[] }).polygons;

// Precompute axis-aligned bounding boxes per polygon for fast rejection.
interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = POLYS.map((p) => {
  const allRings: number[][][] = p.geometry.type === "Polygon"
    ? (p.geometry.coordinates as number[][][])
    : (p.geometry.coordinates as number[][][][]).flat();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of allRings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return { name: p.name, bbox: [minX, minY, maxX, maxY], rings: allRings };
});

function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/// Returns the DC neighborhood name containing (lng, lat), or null if no
/// polygon matches. Uses bbox prefilter so 99% of polygons are rejected
/// before the slower ring test runs.
function geocodeDC(lng: number, lat: number): string | null {
  for (const p of POLY_INDEX) {
    const [minX, minY, maxX, maxY] = p.bbox;
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
    // Point passes bbox — run real ring test. For MultiPolygon-derived
    // ring lists, a point inside an odd number of rings is inside.
    let parity = 0;
    for (const ring of p.rings) if (pointInRing(lng, lat, ring)) parity++;
    if (parity % 2 === 1) return p.name;
  }
  return null;
}

// ---- adapter ----------------------------------------------------------------

const PROVENANCE: DataProvenance = {
  source: "DC MPD Crime Incidents — Last 30 Days (Open Data DC, ArcGIS MapServer)",
  datasetUrl: "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/MPD/MapServer",
  recency: "Refreshed daily by the Metropolitan Police Department (rolling 2-year window of incidents)",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the DC Metropolitan Police Department, with neighborhood " +
    "assigned by point-in-polygon geocoding against DC's official Health Planning " +
    "Neighborhood polygons. Not live, not street-level. CommunitySafe does not track individuals.",
};

async function fetchPage(layer: number, offset: number): Promise<DcRow[]> {
  const url = new URL(BASE_TEMPLATE.replace("{layer}", String(layer)));
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "CCN,OFFENSE,METHOD,START_DATE,WARD,DISTRICT,LATITUDE,LONGITUDE");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "START_DATE DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true"); // v87 — Esri edge cache
  url.searchParams.set("f", "json");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`DC ArcGIS layer=${layer} ${res.status} offset=${offset}`);
  const body = await readJson(res) as { features?: Array<{ attributes: DcRow }> };
  return (body.features ?? []).map((f) => f.attributes);
}

async function fetchDC(): Promise<{ incidents: Incident[]; complete: boolean }> {
  // Pull current year + prior year. The safety-score's 365d wall-clock
  // window then narrows back to one year; without prior-year coverage
  // every score in the first ~365 days of any new calendar year would
  // collapse the moment the year-1 layer dropped out of the query set.
  const currentYear = new Date().getUTCFullYear();
  const layersToPull: number[] = [];
  for (const yr of [currentYear, currentYear - 1]) {
    const layer = YEAR_LAYERS[yr];
    if (layer != null) layersToPull.push(layer);
  }
  // Within each layer, page through up to PAGES × PAGE_SIZE rows.
  // fix(audit loc-dc-partial-cache-2): count page-level errors so the caller can
  // refuse to cache a PARTIAL pull. A thrown page (HTTP error / network drop) and
  // an end-of-data empty page both yield [], but only the former increments
  // pageFailures — so `complete` is false only when a page genuinely failed.
  let pageFailures = 0;
  const allPages = await Promise.all(
    layersToPull.flatMap((layer) =>
      Array.from({ length: PAGES }, (_, i) =>
        fetchPage(layer, i * PAGE_SIZE).catch(() => { pageFailures++; return [] as DcRow[]; })),
    ),
  );
  // Dedupe by CCN — DC's incident numbers are unique across years so a
  // straight map keyed by CCN gives one row per incident even if pages
  // overlap from concurrent crawls.
  const byCcn = new Map<string, DcRow>();
  for (const page of allPages) {
    for (const r of page) {
      const key = r.CCN ?? `${r.START_DATE ?? ""}-${r.OFFENSE ?? ""}-${r.LATITUDE ?? ""}-${r.LONGITUDE ?? ""}`;
      if (!byCcn.has(key)) byCcn.set(key, r);
    }
  }
  const rows = Array.from(byCcn.values());
  // Filter rows with no parseable START_DATE before constructing Incidents.
  // See charlotte-arcgis.ts for the rationale — epoch-fallback rows pollute
  // the citywide aggregator's rate compute and collapse windowDays to 0.
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.START_DATE == null) continue;
    const d = new Date(r.START_DATE);
    if (Number.isNaN(d.getTime()) || d.getTime() <= 0) continue;
    const lat = r.LATITUDE;
    const lon = r.LONGITUDE;
    // Point-in-polygon geocode every row that has coords. Unmatched rows
    // fall back to the ward number rather than an unhelpful "Unknown".
    let area = "Unknown";
    if (typeof lat === "number" && typeof lon === "number" && lat !== 0 && lon !== 0) {
      area = geocodeDC(lon, lat) ?? (r.WARD ? `Ward ${r.WARD}` : "Unknown");
    } else if (r.WARD) {
      area = `Ward ${r.WARD}`;
    }
    out.push({
      id: `dc-${r.CCN ?? i}`,
      area,
      occurredAt: d.toISOString(),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.OFFENSE?.trim() || "Unknown",
      beat: r.DISTRICT ?? null,
      blockLabel: undefined,
      lat: typeof lat === "number" && lat !== 0 ? lat : undefined,
      lng: typeof lon === "number" && lon !== 0 ? lon : undefined,
    });
  }
  return { incidents: out, complete: pageFailures === 0 };
}

// v107 — in-flight fetch dedup (the OOM-guard Detroit added in v94). DC is ~120k
// rows; without this the dispatcher's per-area fan-out fired N concurrent full
// fetches on a cold cache. Concurrent callers now await the same promise.
let inFlightDcFetch: Promise<Incident[]> | null = null;

export async function getRowsDC(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightDcFetch) return inFlightDcFetch;
  inFlightDcFetch = (async () => {
    try {
      const { incidents, complete } = await fetchDC();
      // fix(audit loc-dc-partial-cache-2): only cache a COMPLETE pull. Caching a
      // partial result (some pages errored) would pin an undercount for the whole
      // TTL — the exact bug Detroit hit. On a partial pull we still SERVE what we
      // got for this request, but leave the cache so the next request retries.
      if (incidents.length > 0 && complete) cache = { fetchedAt: now, rows: incidents };
      return incidents.length > 0 ? incidents : (cache?.rows ?? []);
    } catch (err) {
      console.warn("[dc] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightDcFetch = null;
    }
  })();
  return inFlightDcFetch;
}

export async function getDiscoveredAreasDC(): Promise<KnownArea[]> {
  const rows = await getRowsDC();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    // v78 — suppress "Ward N" geocoder-fallback buckets from the discover
    // surface. They have no matching polygon (the dc-neighborhoods polygon
    // file is by neighborhood, not ward) and showed up as orphan picker
    // entries with no map representation. Incidents that hit the ward
    // fallback still count in citywide totals; we just don't expose them
    // as standalone area choices.
    if (/^Ward \d+$/.test(r.area)) continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat; e.lngSum += r.lng; e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 3)
    .map(([name, e]) => ({
      slug: `dc-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: prettifyDCLabel(name),
      jurisdiction: "Washington",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// fix(audit coverage-dc-label-formatting): MPD composite labels render the
// segment after a '/' in lowercase ('Logan Circle/shaw', 'U St/pleasant',
// 'Sw/waterfront') and a couple of acronyms mis-cased ('Gwu'). Capitalize the
// letter after each '/' and uppercase known acronyms. This is CASE-ONLY — it
// changes no letters — so slugs (slugify lowercases) and normName map-matching
// (case-insensitive) are unaffected, keeping saved areas + curated populations
// stable. (Word EXPANSIONS like Sw->Southwest / St->Street would change slugs and
// need the official MPD field values; left as-is.)
const DC_ACRONYMS = new Set(["GWU", "SW", "NW", "NE", "SE"]);
function prettifyDCLabel(s: string): string {
  const cased = s.replace(/\/\s*([a-z])/g, (_, c: string) => "/" + c.toUpperCase());
  return cased
    .split(/(\s|\/)/)
    .map((tok) => (DC_ACRONYMS.has(tok.toUpperCase()) ? tok.toUpperCase() : tok))
    .join("");
}

function labelForDCSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("dc-") ? s.slice(3) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return prettifyDCLabel(r.area);
  }
  return null;
}

export const dcAdapter: CrimeDataAdapter = {
  name: "dc-mpd-arcgis",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsDC();
    const label = labelForDCSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [30, 80, 160, 300]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsDC();
    const label = labelForDCSlug(area, rows);
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
