import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { deriveBands, bucketByBands } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT, readJson } from "../lib/http.js";

// Raleigh — Raleigh PD Police Incidents (NIBRS).
// ArcGIS FeatureServer on services.arcgis.com (owner: Raleigh Open Data).
// Rows carry crime_category (NIBRS Person/Property/Society), reported_date,
// district, and lat/lng. We group by RPD district (~6) which is the
// authoritative reporting geography.
// Doc: https://data-ral.opendata.arcgis.com/datasets/ral::raleigh-police-incidents-nibrs/about

const BASE = "https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Police_Incidents/FeatureServer/0/query";
const PAGE_SIZE = 2000;
const PAGES = 25;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; }, "raleigh-arcgis");

interface RduRow {
  case_number?: string;
  reported_date?: number;
  crime_category?: string;
  crime_description?: string;
  crime_type?: string;
  district?: string;
  latitude?: number;
  longitude?: number;
}

function classify(row: RduRow): CrimeCategory {
  const cat = (row.crime_category ?? "").toLowerCase();
  if (cat.includes("person")) return CrimeCategory.PERSONS;
  if (cat.includes("property")) return CrimeCategory.PROPERTY;
  const desc = `${row.crime_description ?? ""} ${row.crime_type ?? ""}`.toUpperCase();
  if (/(ASSAULT|ROBBERY|HOMICIDE|MURDER|RAPE|SEX|KIDNAP|THREAT)/.test(desc)) return CrimeCategory.PERSONS;
  if (/(BURGLAR|THEFT|LARC|STOLEN|VANDAL|ARSON|FRAUD|MOTOR VEHICLE)/.test(desc)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const RALEIGH_CENTROID = { lat: 35.7796, lng: -78.6382 };

const PROVENANCE: DataProvenance = {
  source: "Raleigh Police Department NIBRS Incidents (Raleigh Open Data, ArcGIS Feature Server)",
  datasetUrl: "https://data-ral.opendata.arcgis.com/datasets/ral::raleigh-police-incidents-nibrs/about",
  recency: "Refreshed daily by Raleigh PD",
  granularity: "beat",
  disclaimer:
    "Incidents are reported by the Raleigh Police Department and grouped by RPD district. " +
    "Not live, not street-level. CommunitySafe does not track individuals.",
};

async function fetchPage(offset: number): Promise<RduRow[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", "district IS NOT NULL AND district <> ''");
  url.searchParams.set("outFields", "case_number,reported_date,crime_category,crime_description,crime_type,district,latitude,longitude");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "reported_date DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Raleigh ArcGIS ${res.status} offset=${offset}`);
  const body = await readJson(res) as { features?: Array<{ attributes: RduRow }> };
  return (body.features ?? []).map((f) => f.attributes);
}

async function fetchRaleigh(): Promise<Incident[]> {
  const results: RduRow[][] = new Array(PAGES);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PAGES) return;
      results[i] = await fetchPage(i * PAGE_SIZE).catch(() => [] as RduRow[]);
    }
  });
  await Promise.all(workers);
  const rows = results.flat();
  return rows
    .filter((r) => r.reported_date && r.district)
    .map((r, i) => ({
      id: `rdu-${r.case_number ?? i}`,
      area: r.district!,
      occurredAt: new Date(r.reported_date!).toISOString(),
      nibrsCategory: classify(r),
      ibrOffenseDescription: (r.crime_description ?? r.crime_type ?? r.crime_category ?? "Unknown").trim(),
      beat: r.district ?? null,
      blockLabel: undefined,
      lat: typeof r.latitude === "number" && r.latitude !== 0 ? r.latitude : RALEIGH_CENTROID.lat,
      lng: typeof r.longitude === "number" && r.longitude !== 0 ? r.longitude : RALEIGH_CENTROID.lng,
    }));
}

// v107 — in-flight fetch dedup (the OOM-guard Detroit added in v94): the
// dispatcher fans a per-area Promise.all over every neighbourhood, so a cold
// cache previously fired N concurrent full fetches. Concurrent callers now
// await the same promise.
let inFlightRaleighFetch: Promise<Incident[]> | null = null;
export async function getRowsRaleigh(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightRaleighFetch) return inFlightRaleighFetch;
  inFlightRaleighFetch = (async () => {
    try {
      const rows = await fetchRaleigh();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[rdu] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightRaleighFetch = null;
    }
  })();
  return inFlightRaleighFetch;
}

export async function getDiscoveredAreasRaleigh(): Promise<KnownArea[]> {
  const rows = await getRowsRaleigh();
  // v108 — ~37% of Raleigh rows have null/0 coords and fall back to
  // RALEIGH_CENTROID (set in fetchRaleigh). Including those in the per-district
  // centroid average pulled ALL six districts' map pins toward downtown. Track
  // real-coord contributions (coordN) separately from total presence so a
  // district still appears, but its centroid is averaged ONLY over genuine
  // per-incident coords (mirrors the Atlanta coordN guard). Counts/grades are
  // unaffected — this is map-pin accuracy only.
  const agg = new Map<string, { latSum: number; lngSum: number; coordN: number; total: number }>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, coordN: 0, total: 0 };
    e.total += 1;
    if (
      r.lat != null && r.lng != null &&
      !(r.lat === RALEIGH_CENTROID.lat && r.lng === RALEIGH_CENTROID.lng)
    ) {
      e.latSum += r.lat; e.lngSum += r.lng; e.coordN += 1;
    }
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.total >= 1)
    .map(([name, e]) => ({
      slug: `rdu-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Raleigh",
      centroid: e.coordN > 0
        ? { lat: e.latSum / e.coordN, lng: e.lngSum / e.coordN }
        : { ...RALEIGH_CENTROID },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// perf(raleigh-index): getAreaStats/getIncidents are called once per district in
// the citywide compose; each used to scan all rows (rows.filter + labelForRduSlug
// + riskLevelFromAreaCounts) → O(districts × rows). Mirror Detroit/Saint Paul:
// build a district→rows Map once, memoized by the rows-array identity.
interface RduIndex { rows: Incident[]; labelToRows: Map<string, Incident[]>; slugToLabel: Map<string, string> }
let rduIndex: RduIndex | null = null;
function getRaleighIndex(rows: Incident[]): RduIndex {
  if (rduIndex && rduIndex.rows === rows) return rduIndex;
  const labelToRows = new Map<string, Incident[]>();
  const slugToLabel = new Map<string, string>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    let bucket = labelToRows.get(r.area);
    if (!bucket) {
      bucket = [];
      labelToRows.set(r.area, bucket);
      slugToLabel.set(r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), r.area);
    }
    bucket.push(r);
  }
  rduIndex = { rows, labelToRows, slugToLabel };
  return rduIndex;
}

function labelForRduSlug(slug: string, index: RduIndex): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("rdu-") ? s.slice(4) : s;
  return index.slugToLabel.get(want) ?? null;
}

export const raleighAdapter: CrimeDataAdapter = {
  name: "raleigh-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const index = getRaleighIndex(await getRowsRaleigh());
    const label = labelForRduSlug(area, index);
    if (!label) return null;
    const inArea = index.labelToRows.get(label) ?? [];
    if (inArea.length === 0) return null;
    // Equivalent to the prior riskLevelFromAreaCounts but over the precomputed
    // index distribution instead of re-scanning all rows.
    const dist = [...index.labelToRows.values()].map((g) => g.length).filter((n) => n >= 3);
    const riskLevel = bucketByBands(inArea.length, deriveBands(dist, [150, 500, 1000, 2000]));
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },
  async getIncidents(area, opts) {
    const index = getRaleighIndex(await getRowsRaleigh());
    const label = labelForRduSlug(area, index);
    if (!label) return [];
    let filtered = index.labelToRows.get(label) ?? [];
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    else filtered = [...filtered];
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area, opts) { return this.getIncidents(area, { limit: opts?.limit ?? 20 }); },
};
