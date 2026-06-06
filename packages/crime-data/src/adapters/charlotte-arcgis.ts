import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";

// Charlotte — CMPD Incidents on gis.charlottenc.gov ArcGIS MapServer.
// ~14 patrol divisions (University City, Steele Creek, North, Westover,
// Central, Metro, Freedom, Providence, North Tryon, Hickory Grove,
// Independence, South, Eastway, Airport). CMPD also publishes an
// integer NPA (Neighborhood Profile Area) on every row but there are
// ~460 NPAs city-wide — too granular for users to recognize, so we use
// the named patrol division as the area label.
// Doc: https://gis.charlottenc.gov/arcgis/rest/services/CMPD/CMPDIncidents/MapServer/0

const BASE = "https://gis.charlottenc.gov/arcgis/rest/services/CMPD/CMPDIncidents/MapServer/0/query";
const PAGE_SIZE = 2000;
// 30 pages × 2,000 = 60,000 rows. CMPD publishes ~250 incidents/day,
// so the earlier 10k limit covered ~40 days but reported a 364-day
// windowDays (a handful of cached rows with backdated DATE_INCIDENT_
// BEGAN values latched dataEarliestMs to year-old timestamps).
// Either way, 10k rows over 364 days annualized to roughly 6.5 P+P
// incidents per 100k per year — about 10× below Charlotte's real
// FBI rate. 60k rows ≈ 240 days of recent activity; safety-score's
// 365d clamp then trims back honestly.
// v107 — tiered cold load: fetch the most-recent pages first so current
// activity + the division list are servable within a few seconds, then backfill
// the rest in the background for full-depth baselines. Pre-v107 a cold cache
// blocked on all 30 pages, so the warm path raced the route timeout and could
// serve empty (same failure class fixed for Atlanta).
const RECENT_PAGES = 6;
const PAGES = 30;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[]; full: boolean } | null = null;
let lastGoodAreas: KnownArea[] | null = null;
let bgDeepenInFlight = false;
registerRowCache(() => { cache = null; }, "charlotte-arcgis");

interface CmpdRow {
  YEAR?: string;
  INCIDENT_REPORT_ID?: string;
  CMPD_PATROL_DIVISION?: string;
  NPA?: number;
  DATE_REPORTED?: number;            // epoch ms
  DATE_INCIDENT_BEGAN?: number;      // epoch ms
  HIGHEST_NIBRS_CODE?: string;
  HIGHEST_NIBRS_DESCRIPTION?: string;
  LATITUDE_PUBLIC?: number;
  LONGITUDE_PUBLIC?: number;
  LOCATION?: string;
}

// CMPD publishes the NIBRS code and a clean description. We map the NIBRS
// description to PERSONS / PROPERTY / SOCIETY via keyword groups. (NIBRS
// itself classifies Robbery as a property crime, which is the FBI's official
// taxonomy — we preserve that here.)
// v31 calibration: ROBBERY moved from PROPERTY to PERSONS. CMPD's
// internal taxonomy puts Robbery under Crime-Against-Property
// (because the target is property), but FBI UCR Part 1 groups
// Robbery under Violent — which is what the FBI baseline uses.
// The earlier mapping made Charlotte's PERSONS rate look ~50% of
// FBI baseline (we missed all robberies); aligning to FBI fixes
// it. Also dropped MISSING PERSON and SUDDEN/NATURAL DEATH from
// PERSONS — they're administrative, not violent crime.
const PERSONS_KEYS = [
  "ASSAULT", "ROBBERY", "HOMICIDE", "MURDER", "MANSLAUGHTER",
  "KIDNAPPING", "SEX OFFENSE", "RAPE", "HUMAN TRAFFICKING",
];
const PROPERTY_KEYS = [
  "THEFT", "BURGLARY", "B&E", "LARCENY", "MOTOR VEHICLE",
  "ARSON", "VANDALISM", "DAMAGE", "FORGERY",
  "FRAUD", "EMBEZZLEMENT", "COUNTERFEIT", "STOLEN PROPERTY",
  "IDENTITY THEFT", "CREDIT CARD", "FALSE PRETENSES", "SHOPLIFTING",
];

function mapToNibrs(row: CmpdRow): CrimeCategory {
  const t = (row.HIGHEST_NIBRS_DESCRIPTION ?? "").toUpperCase();
  if (PERSONS_KEYS.some((k) => t.includes(k))) return CrimeCategory.PERSONS;
  if (PROPERTY_KEYS.some((k) => t.includes(k))) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "Charlotte-Mecklenburg Police Department CMPD Incidents (City of Charlotte Open Data, ArcGIS MapServer)",
  datasetUrl: "https://data.charlottenc.gov/datasets/CharlotteNC::cmpd-incidents",
  recency: "Refreshed daily by CMPD",
  // fix(audit coverage-clt-divisions): the areas are CMPD's 14 patrol DIVISIONS
  // (each ~10-20 sq mi), not neighborhoods — label the grain as "beat" (police
  // patrol area) so the at-a-glance provenance doesn't overstate the resolution.
  // The disclaimer below spells out the division grain.
  granularity: "beat",
  disclaimer:
    "Incidents are reported by the Charlotte-Mecklenburg Police Department and " +
    "aggregated to CMPD's 14 patrol divisions (each ~10-20 sq mi). CMPD does not " +
    "publish suspect / victim demographic columns on this feed.",
};

async function fetchPage(offset: number): Promise<CmpdRow[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "YEAR,INCIDENT_REPORT_ID,CMPD_PATROL_DIVISION,NPA,DATE_REPORTED,DATE_INCIDENT_BEGAN,HIGHEST_NIBRS_CODE,HIGHEST_NIBRS_DESCRIPTION,LATITUDE_PUBLIC,LONGITUDE_PUBLIC,LOCATION");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "DATE_REPORTED DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true"); // v87 — Esri edge cache
  url.searchParams.set("f", "json");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
  });
  if (!res.ok) throw new Error(`Charlotte ArcGIS ${res.status} offset=${offset}`);
  const body = await res.json() as { features?: Array<{ attributes: CmpdRow }> };
  return (body.features ?? []).map((f) => f.attributes);
}

function mapCharlotteRows(rows: CmpdRow[]): Incident[] {
  // Filter out rows with no parseable date BEFORE constructing Incidents.
  // The earlier `new Date(0).toISOString()` fallback survived row mapping
  // but was filtered out by the citywide aggregator's `t > 0` invariant,
  // collapsing the rate-compute window to 0 days and rendering the score
  // as 0.00× national misleadingly. Dropping these rows up-front keeps
  // the row.length honest (= rows with usable timestamps) and the
  // citywide rate windowDays > 0.
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rawDate = r.DATE_INCIDENT_BEGAN ?? r.DATE_REPORTED;
    if (rawDate == null) continue;
    const d = new Date(rawDate);
    if (Number.isNaN(d.getTime()) || d.getTime() <= 0) continue;
    const div = r.CMPD_PATROL_DIVISION?.trim();
    const area = div && div !== "NA" ? div : "Unknown";
    out.push({
      id: `clt-${r.INCIDENT_REPORT_ID ?? i}`,
      area,
      occurredAt: d.toISOString(),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.HIGHEST_NIBRS_DESCRIPTION?.trim() || "Unknown",
      beat: r.NPA != null ? `NPA ${r.NPA}` : null,
      blockLabel: undefined,
      lat: typeof r.LATITUDE_PUBLIC === "number" && r.LATITUDE_PUBLIC !== 0 ? r.LATITUDE_PUBLIC : undefined,
      lng: typeof r.LONGITUDE_PUBLIC === "number" && r.LONGITUDE_PUBLIC !== 0 ? r.LONGITUDE_PUBLIC : undefined,
    });
  }
  return out;
}

// Fetch the half-open page range [startPage, endPage) with bounded concurrency.
// v69 followup-5 — concurrency 4 (not all-parallel): Charlotte's ArcGIS host
// rate-limited 30 simultaneous requests down to ~1 success/cycle, leaving the
// cache with a single page (~2k rows) and a bogus 0.02× citywide ratio. A
// per-page failure degrades to [] rather than failing the whole pull.
async function fetchCharlotteRange(startPage: number, endPage: number): Promise<Incident[]> {
  const offsets = Array.from({ length: endPage - startPage }, (_, i) => (startPage + i) * PAGE_SIZE);
  const results: CmpdRow[][] = new Array(offsets.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, offsets.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= offsets.length) return;
      results[idx] = await fetchPage(offsets[idx]).catch(() => [] as CmpdRow[]);
    }
  });
  await Promise.all(workers);
  return mapCharlotteRows(results.flat());
}

// v107 — background deep-load (see atlanta-arcgis.ts for the pattern).
async function deepenCharlotte(recentRows: Incident[]): Promise<void> {
  if (bgDeepenInFlight) return;
  bgDeepenInFlight = true;
  try {
    const rest = await fetchCharlotteRange(RECENT_PAGES, PAGES);
    if (rest.length === 0) return;
    const byId = new Map<string, Incident>();
    for (const r of recentRows) byId.set(r.id, r);
    for (const r of rest) if (!byId.has(r.id)) byId.set(r.id, r);
    const merged = Array.from(byId.values());
    cache = { fetchedAt: Date.now(), rows: merged, full: true };
    lastGoodAreas = buildCharlotteAreas(merged);
  } catch (err) {
    console.warn("[clt] deepen failed:", (err as Error).message);
  } finally {
    bgDeepenInFlight = false;
  }
}

// v94 — in-flight Promise dedup (see detroit-arcgis.ts for rationale).
let inFlightCltFetch: Promise<Incident[]> | null = null;

export async function getRowsCharlotte(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightCltFetch) return inFlightCltFetch;
  inFlightCltFetch = (async () => {
    try {
      const recent = await fetchCharlotteRange(0, RECENT_PAGES);
      if (recent.length > 0) {
        cache = { fetchedAt: now, rows: recent, full: false };
        lastGoodAreas = buildCharlotteAreas(recent);
        void deepenCharlotte(recent);
        return recent;
      }
      return cache?.rows ?? [];
    } catch (err) {
      console.warn("[clt] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightCltFetch = null;
    }
  })();
  return inFlightCltFetch;
}

function buildCharlotteAreas(rows: Incident[]): KnownArea[] {
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
      slug: `clt-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Charlotte",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// v107 — supersedes the v96 "always AWAIT on cold cache" behaviour. The tiered
// cold load now resolves the awaited path in a few seconds (not ~45s), and a
// last-known-good area list (populated by any prior successful pull in this pod)
// is served instantly while a refresh runs in the background — the
// Detroit/Cleveland LKG pattern. So discover never blocks on the full fetch and
// never returns a degenerate empty once the pod has warmed even once.
export async function getDiscoveredAreasCharlotte(): Promise<KnownArea[]> {
  if (cache && cache.rows.length > 0) {
    return buildCharlotteAreas(cache.rows);
  }
  if (lastGoodAreas && lastGoodAreas.length > 0) {
    void getRowsCharlotte().catch(() => {});  // refresh in background
    return lastGoodAreas;
  }
  const rows = await getRowsCharlotte().catch(() => [] as Incident[]);
  if (rows.length === 0) return [];
  return buildCharlotteAreas(rows);
}

function labelForCharlotteSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("clt-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const charlotteAdapter: CrimeDataAdapter = {
  name: "charlotte-arcgis",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsCharlotte();
    const label = labelForCharlotteSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [100, 300, 500, 800]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsCharlotte();
    const label = labelForCharlotteSlug(area, rows);
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
