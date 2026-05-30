import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { bucketByBands, deriveBands } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";

// Detroit — RMS_Crime_Incidents on services2.arcgis.com.
// ESRI Feature Server, same shape as Denver. Detroit's old Socrata endpoint
// on data.detroitmi.gov was retired; this ArcGIS feed is the canonical
// public source.
// Doc: https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/RMS_Crime_Incidents/FeatureServer

const BASE = "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/RMS_Crime_Incidents/FeatureServer/0/query";
const PAGE_SIZE = 2000;
// v26 bump 5 → 15. Even after the v26 classifier fix that picked
// up AGGRAVATED ASSAULT / HOMICIDE / SEXUAL ASSAULT, the 10k cache
// only spans ~12 days of Detroit's high crime volume; deeper cache
// gives the annualization a true year-scale window.
const PAGES = 15;
const CACHE_TTL_MS = 5 * 60 * 1000;
// v69 followup — paired index keyed off the cache fetchedAt so the
// index rebuilds whenever the row cache refreshes. Two structures:
//   slugToLabel: O(1) slug → upstream-label lookup (was O(n_areas ×
//     n_rows) per call)
//   labelToRows: O(1) label → Incident[] lookup (was rows.filter on
//     every getIncidents call)
// Detroit has 199 areas × ~30k rows; the cumulative win is ~5.97M
// ops → ~200 indexed lookups per warm-worker cycle.
interface Cache {
  fetchedAt: number;
  rows: Incident[];
  slugToLabel: Map<string, string>;
  labelToRows: Map<string, Incident[]>;
}
let cache: Cache | null = null;
registerRowCache(() => { cache = null; });

interface DetroitRow {
  crime_id?: string;
  offense_category?: string;     // ALL-CAPS: "DAMAGE TO PROPERTY", "ASSAULT"
  offense_description?: string;
  incident_occurred_at?: number; // epoch ms
  neighborhood?: string;
  council_district?: number;
  police_precinct?: string | null;
  latitude?: number;
  longitude?: number;
}

// Detroit DPD splits violent crime across SEVEN distinct
// offense_category strings. The prior set (v24 and earlier) only
// captured 4 of them — AGGRAVATED ASSAULT, SEXUAL ASSAULT, and
// HOMICIDE were silently classified as SOCIETY, dropping ~88k
// violent incidents per year out of the PERSONS bucket. That made
// Detroit's local violent rate look like 29% of the FBI Part-1
// baseline and earned the city a misleading Grade A. v25
// added the divergence guard; v26 fixes the underlying mapping.
const PERSONS_CATEGORIES = new Set([
  "ASSAULT", "AGGRAVATED ASSAULT", "MURDER", "HOMICIDE", "JUSTIFIABLE HOMICIDE",
  "ROBBERY", "SEX OFFENSES", "SEXUAL ASSAULT",
  "KIDNAPPING", "FAMILY OFFENSE", "HUMAN TRAFFICKING",
]);
const PROPERTY_CATEGORIES = new Set([
  "BURGLARY", "LARCENY", "MOTOR VEHICLE THEFT", "STOLEN VEHICLE",
  "ARSON", "DAMAGE TO PROPERTY", "FRAUD", "FORGERY", "STOLEN PROPERTY",
  "EMBEZZLEMENT", "EXTORTION",
]);
function mapToNibrs(row: DetroitRow): CrimeCategory {
  const c = (row.offense_category ?? "").trim().toUpperCase();
  if (PERSONS_CATEGORIES.has(c)) return CrimeCategory.PERSONS;
  if (PROPERTY_CATEGORIES.has(c)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "Detroit RMS Crime Incidents (City of Detroit Open Data, ArcGIS Feature Server)",
  datasetUrl: "https://data.detroitmi.gov/datasets/rms-crime-incidents",
  recency: "Refreshed daily by the Detroit Police Department",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Detroit Police Department and aggregated " +
    "to Detroit's named neighborhoods — not live, not street-level. CommunitySafe " +
    "does not track individuals.",
};

async function fetchPage(offset: number): Promise<DetroitRow[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "crime_id,offense_category,offense_description,incident_occurred_at,neighborhood,council_district,police_precinct,latitude,longitude");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "incident_occurred_at DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true"); // v87 — Esri edge cache
  url.searchParams.set("f", "json");
  // v99 — retry deep-offset pages. Detroit's Esri Feature Server
  // intermittently returns 400 "Invalid query parameters" on deep-offset
  // (resultOffset up to 28k) requests under concurrency. The old code
  // .catch(()=>[])'d each failure and cached the partial result, so a
  // 12k-instead-of-30k pull silently deflated Detroit's ENTIRE citywide rate
  // ~2× (mis-grading a very-high-crime city as "A"). Retry up to 3× with
  // backoff and throw on final failure so the caller can detect incompleteness.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 250 * attempt));
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
      });
      if (!res.ok) throw new Error(`Detroit ArcGIS ${res.status} offset=${offset}`);
      const body = await res.json() as { features?: Array<{ attributes: DetroitRow }>; error?: unknown };
      if (body.error) throw new Error(`Detroit ArcGIS body error offset=${offset}`);
      return (body.features ?? []).map((f) => f.attributes);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function fetchDetroit(): Promise<{ rows: Incident[]; complete: boolean }> {
  // v99 — bounded concurrency (4) instead of firing all 15 deep-offset pages
  // at once (the burst is what triggers the Esri 400s), plus completeness
  // tracking so a partial pull is never silently cached.
  const results: DetroitRow[][] = new Array(PAGES);
  let cursor = 0;
  let failures = 0;
  const workers = Array.from({ length: 4 }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= PAGES) return;
      try { results[i] = await fetchPage(i * PAGE_SIZE); }
      catch { results[i] = []; failures += 1; }
    }
  });
  await Promise.all(workers);
  const rows = results.flat();
  // Drop rows with no parseable date — see nypd-socrata for rationale.
  // Epoch fallback would collapse Detroit citywide windowDays to 0.
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.incident_occurred_at == null) continue;
    const d = new Date(r.incident_occurred_at);
    if (Number.isNaN(d.getTime()) || d.getTime() <= 0) continue;
    const lat = r.latitude;
    const lon = r.longitude;
    const area = r.neighborhood?.trim() || "Unknown";
    // Detroit prints offense_description with trailing whitespace padding —
    // trim it so the autocomplete + drill-down read cleanly.
    const desc = r.offense_description?.trim().replace(/\s+/g, " ") || r.offense_category?.trim() || "Unknown";
    out.push({
      id: `det-${r.crime_id ?? i}`,
      area,
      occurredAt: d.toISOString(),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: titleCaseOffense(desc),
      beat: r.police_precinct ?? null,
      blockLabel: undefined,
      lat: typeof lat === "number" && lat !== 0 ? lat : undefined,
      lng: typeof lon === "number" && lon !== 0 ? lon : undefined,
    });
  }
  return { rows: out, complete: failures === 0 };
}

// v69 followup — build the two indexes once per cache load.
function buildIndexes(rows: Incident[]): Pick<Cache, "slugToLabel" | "labelToRows"> {
  const slugToLabel = new Map<string, string>();
  const labelToRows = new Map<string, Incident[]>();
  for (const r of rows) {
    const label = r.area;
    if (!label) continue;
    let bucket = labelToRows.get(label);
    if (!bucket) { bucket = []; labelToRows.set(label, bucket); }
    bucket.push(r);
    if (!slugToLabel.has(label)) {
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      slugToLabel.set(slug, label);
    }
  }
  return { slugToLabel, labelToRows };
}

// v94 — in-flight Promise deduplication. Pre-v94 the dispatcher's
// per-area Promise.all (208 Detroit neighborhoods) on cold cache
// fired 208 simultaneous getRowsDetroit() calls. Each one independently
// invoked fetchDetroit (15 pages × 2k rows × concurrency 4), allocating
// its own row buffer — 208 × 30k = ~6M rows in flight, hitting Node's
// 4GB heap limit and OOM-killing the container (exit 134, observed in
// a 15.8-hour grade-sanity cycle).
// Now: once a fetch starts, every concurrent caller awaits the SAME
// promise. First-to-return populates the cache; the rest reuse the
// already-fetched rows. Cuts memory pressure from O(N areas) to O(1).
let inFlightFetch: Promise<Incident[]> | null = null;

export async function getRowsDetroit(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightFetch) return inFlightFetch;
  inFlightFetch = (async () => {
    try {
      const { rows, complete } = await fetchDetroit();
      // v99 — only overwrite a good cache when the pull was COMPLETE (every
      // page loaded). A partial pull under-counts every neighborhood
      // uniformly and would mis-grade the whole city; serve the prior
      // last-known-good cache instead. With no prior cache, a partial pull is
      // still better than nothing.
      if (rows.length > 0 && (complete || !cache)) {
        cache = { fetchedAt: now, rows, ...buildIndexes(rows) };
      }
      return cache?.rows ?? rows;
    } catch (err) {
      console.warn("[detroit] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightFetch = null;
    }
  })();
  return inFlightFetch;
}

// v90p9 — bundled polygon set as static seed. Returned by discover()
// when the in-process row cache is cold (same pattern as Cleveland
// v89). Each polygon's centroid is approximated from its bbox
// midpoint. Once warm-worker populates the live row cache, the
// LKG path takes over and returns adapter-derived centroids.
import { detroitPolygons } from "../data/detroit-neighborhoods.js";
const STATIC_DETROIT_AREAS: KnownArea[] = detroitPolygons.map((p) => {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  const rings: number[][][] = p.geometry.type === "Polygon"
    ? (p.geometry.coordinates as number[][][])
    : (p.geometry.coordinates as number[][][][]).flat();
  for (const ring of rings) for (const [lng, lat] of ring) {
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
  }
  return {
    slug: `det-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    label: p.name,
    jurisdiction: "Detroit",
    centroid: { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 },
  };
});

function buildDetroitAreas(rows: Incident[]): KnownArea[] {
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
      slug: `det-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Detroit",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// v90p7 — LKG (last-known-good) pattern. Pre-v90p7 the discover()
// route blocked synchronously on getRowsDetroit() — Detroit's
// 30-page bounded ArcGIS fetch routinely takes 30-60s on cold
// cache, exceeding HTTP-client timeouts. Now returns cached if
// available, otherwise fires the refresh in the background and
// returns []. Warm-worker populates within ~30s of container boot.
// Same fix as Cleveland v77.
export async function getDiscoveredAreasDetroit(): Promise<KnownArea[]> {
  if (cache && cache.rows.length > 0) {
    return buildDetroitAreas(cache.rows);
  }
  // v90p9 — return bundled static seed during cold-cache window
  // (was returning [] which left the map empty for ~30s after each
  // container restart). Fire-and-forget refresh so live data takes
  // over as soon as the warm cycle finishes.
  void getRowsDetroit().catch(() => {});
  return STATIC_DETROIT_AREAS;
}

// v69 followup — O(1) slug → label via the cache-time index.
function labelForDetroitSlug(slug: string): string | null {
  if (!cache) return null;
  const s = slug.toLowerCase();
  const want = s.startsWith("det-") ? s.slice(4) : s;
  return cache.slugToLabel.get(want) ?? null;
}

export const detroitAdapter: CrimeDataAdapter = {
  name: "detroit-arcgis",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    await getRowsDetroit();
    const label = labelForDetroitSlug(area);
    if (!label) return null;
    const inArea = cache?.labelToRows.get(label) ?? [];
    if (inArea.length === 0) return null;
    // Self-calibrating quintile bands over this city's own per-area
    // distribution (the cached labelToRows map sizes, floored at 3 to
    // ignore stray geocodes); degrades to the prior hand-tuned thresholds.
    const dist = [...(cache?.labelToRows.values() ?? [])].map((g) => g.length).filter((n) => n >= 3);
    const riskLevel = bucketByBands(inArea.length, deriveBands(dist, [60, 200, 400, 800]));
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    await getRowsDetroit();
    const label = labelForDetroitSlug(area);
    if (!label) return [];
    let filtered = cache?.labelToRows.get(label) ?? [];
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    // Index buckets aren't pre-sorted; sort on the fly. Most callers
    // pass limit > bucket size so the cost is bounded by the bucket
    // size rather than the global row count.
    filtered = [...filtered].sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },

  async getRecentReports(area: string, opts?: { limit?: number }) {
    return this.getIncidents(area, { limit: opts?.limit ?? 20 });
  },
};
