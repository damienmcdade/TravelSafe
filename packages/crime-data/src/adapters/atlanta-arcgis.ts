import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT, readJson } from "../lib/http.js";

// Atlanta — Atlanta PD Crimes (OpenDataWebsite_Crime_view).
// ArcGIS FeatureServer on services3.arcgis.com (owner: RJStanionis0638
// — the same admin as the official Atlanta Police Open Data Hub).
//
// v90p11 — replaced the scout-misidentified `aJ16ENn1AaqdFlqx` endpoint
// (Asheville NC data, all neighborhoods NULL) with the correct
// APD-administered view that powers atlanta-police-opendata-atlantapd
// .hub.arcgis.com's live NPU + Neighborhood Crime Map dashboards.
//
// 243k records, refreshed daily, lat/lng + NhoodName per row.
// Doc: https://atlanta-police-opendata-atlantapd.hub.arcgis.com/

const BASE = "https://services3.arcgis.com/Et5Qfajgiyosiw4d/arcgis/rest/services/OpenDataWebsite_Crime_view/FeatureServer/0/query";
const PAGE_SIZE = 2000;
// v107 — tiered cold load. Pre-v107 a cold cache blocked on all 30 pages
// (~60k rows, ~45s) before returning ANYTHING. Atlanta is the slowest
// ArcGIS cold load in the fleet, so it routinely lost the ~45s route-timeout
// race and served EMPTY → "all Atlanta neighborhoods show no current
// activity". Now we fetch the most-recent RECENT_PAGES first (ordered
// OccurredFromDate DESC), cache + serve those within a few seconds so current
// activity and the area list are immediately available, then backfill the
// remaining pages in the background to restore full-depth baselines.
const RECENT_PAGES = 6;  // ~12k most-recent rows — covers current activity + every active neighbourhood
const PAGES = 30;        // ~60k recent incidents — full depth for accurate baseline counts
const CACHE_TTL_MS = 5 * 60 * 1000;
// `full` flips true once the background deep-load has merged all pages, so a
// recent-only tier isn't mistaken for the complete dataset.
let cache: { fetchedAt: number; rows: Incident[]; full: boolean } | null = null;
// v107 — last-known-good area list, so a transient empty pull (or the brief
// cold window before the first fetch returns) never blanks the neighbourhood
// list. Mirrors Detroit/Cleveland's STATIC_<city>_AREAS seed, but derived from
// live data instead of a bundled polygon file (Atlanta has no polygon bundle).
let lastGoodAreas: KnownArea[] | null = null;
// v107 — in-flight fetch dedup. The dispatcher fans out a per-area Promise.all
// over all 246 Atlanta neighbourhoods; on a cold cache that previously fired
// 246 simultaneous getRowsAtlanta() calls, each allocating its own ~60k-row
// buffer (246 × 60k ≈ 15M rows in flight → OOM, the same failure Detroit fixed
// in v94 and the likely driver of the warm-worker OOM that disabled it). Now
// concurrent callers all await the SAME promise.
let inFlightFetch: Promise<Incident[]> | null = null;
let bgDeepenInFlight = false;
registerRowCache(() => { cache = null; }, "atlanta-arcgis");

interface AtlRow {
  IncidentNumber?: string;
  ReportDate?: number;
  OccurredFromDate?: number;
  NIBRS_Offense?: string;
  NhoodName?: string;
  NPU?: string;
  BEAT?: string;
  Zone?: string;
  Latitude?: number;
  Longitude?: number;
}

function classify(row: AtlRow): CrimeCategory {
  const desc = (row.NIBRS_Offense ?? "").toUpperCase();
  // v98 — the data audit found Atlanta's grade suppressed to N/A by the
  // divergence guard (adapter rate ~28% of FBI baseline). A contributing
  // cause: standard NIBRS offense descriptions the regex missed were
  // falling through to SOCIETY, undercounting the graded categories.
  // Added: FONDLING (NIBRS sex offense → PERSONS); FALSE PRETENSES /
  // SWINDLE / CONFIDENCE GAME + IMPERSONATION (NIBRS fraud → PROPERTY);
  // PURSE-SNATCHING (larceny → PROPERTY); EXTORTION / BLACKMAIL
  // (→ PROPERTY). ~12k Atlanta incidents re-bucketed to the correct group.
  if (/(ASSAULT|BATTERY|ROBBERY|HOMICIDE|MURDER|MANSLAUGHTER|RAPE|SEX|FONDLING|KIDNAP|STALK|THREAT|INTIMIDAT|DOMESTIC)/.test(desc)) return CrimeCategory.PERSONS;
  if (/(BURGLAR|THEFT|LARC|STOLEN|VANDAL|DAMAGE|ARSON|FRAUD|FALSE PRETENSE|SWINDLE|CONFIDENCE GAME|IMPERSONAT|FORGE|MOTOR VEHICLE|EMBEZ|COUNTERFEIT|SHOPLIFT|PURSE-SNATCH|EXTORTION|BLACKMAIL)/.test(desc)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const ATLANTA_CENTROID = { lat: 33.7490, lng: -84.3880 };

const PROVENANCE: DataProvenance = {
  source: "Atlanta Police Department OpenDataWebsite_Crime_view (Atlanta Police Open Data Hub, ArcGIS Feature Server)",
  datasetUrl: "https://atlanta-police-opendata-atlantapd.hub.arcgis.com/",
  recency: "Refreshed daily by Atlanta PD",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Atlanta Police Department and grouped by NPU/Neighborhood. " +
    "Not live, not street-level. CommunitySafe does not track individuals.",
};

async function fetchPage(offset: number): Promise<AtlRow[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", "NhoodName IS NOT NULL AND NhoodName <> ''");
  url.searchParams.set("outFields", "IncidentNumber,ReportDate,OccurredFromDate,NIBRS_Offense,NhoodName,NPU,BEAT,Zone,Latitude,Longitude");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "OccurredFromDate DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Atlanta ArcGIS ${res.status} offset=${offset}`);
  const body = await readJson(res) as { features?: Array<{ attributes: AtlRow }> };
  return (body.features ?? []).map((f) => f.attributes);
}

function mapRows(rows: AtlRow[]): Incident[] {
  return rows
    .filter((r) => (r.OccurredFromDate || r.ReportDate) && r.NhoodName)
    .map((r, i) => ({
      id: `atl-${r.IncidentNumber ?? i}`,
      area: r.NhoodName!,
      occurredAt: new Date(r.OccurredFromDate ?? r.ReportDate!).toISOString(),
      nibrsCategory: classify(r),
      ibrOffenseDescription: (r.NIBRS_Offense ?? "Unknown").trim(),
      beat: r.BEAT ?? r.Zone ?? null,
      blockLabel: undefined,
      lat: typeof r.Latitude === "number" && r.Latitude !== 0 ? r.Latitude : ATLANTA_CENTROID.lat,
      lng: typeof r.Longitude === "number" && r.Longitude !== 0 ? r.Longitude : ATLANTA_CENTROID.lng,
    }));
}

// Fetch the half-open page range [startPage, endPage) with bounded concurrency,
// in OccurredFromDate-DESC order (so page 0 is the most recent). A single page
// failure degrades to [] rather than failing the whole pull.
async function fetchPageRange(startPage: number, endPage: number): Promise<Incident[]> {
  const count = endPage - startPage;
  const results: AtlRow[][] = new Array(count);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= count) return;
      results[i] = await fetchPage((startPage + i) * PAGE_SIZE).catch(() => [] as AtlRow[]);
    }
  });
  await Promise.all(workers);
  return mapRows(results.flat());
}

// v107 — background deep-load: pull the remaining pages and merge with the
// already-served recent tier (dedup by incident id), upgrading the cache to a
// full-depth dataset. Fire-and-forget; failure just leaves the recent tier in
// place to be retried on the next TTL lapse.
async function deepenAtlanta(recentRows: Incident[]): Promise<void> {
  if (bgDeepenInFlight) return;
  bgDeepenInFlight = true;
  try {
    const rest = await fetchPageRange(RECENT_PAGES, PAGES);
    if (rest.length === 0) return;  // nothing gained; keep the recent tier as-is
    const byId = new Map<string, Incident>();
    for (const r of recentRows) byId.set(r.id, r);
    for (const r of rest) if (!byId.has(r.id)) byId.set(r.id, r);
    const merged = Array.from(byId.values());
    cache = { fetchedAt: Date.now(), rows: merged, full: true };
    lastGoodAreas = buildAtlantaAreas(merged);
  } catch (err) {
    console.warn("[atl] deepen failed:", (err as Error).message);
  } finally {
    bgDeepenInFlight = false;
  }
}

export async function getRowsAtlanta(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightFetch) return inFlightFetch;
  inFlightFetch = (async () => {
    try {
      // Tiered cold load: serve the most-recent pages fast, then backfill.
      const recent = await fetchPageRange(0, RECENT_PAGES);
      if (recent.length > 0) {
        cache = { fetchedAt: now, rows: recent, full: false };
        lastGoodAreas = buildAtlantaAreas(recent);
        void deepenAtlanta(recent);
        return recent;
      }
      return cache?.rows ?? [];
    } catch (err) {
      console.warn("[atl] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightFetch = null;
    }
  })();
  return inFlightFetch;
}

function buildAtlantaAreas(rows: Incident[]): KnownArea[] {
  // fix(audit coverage-atlanta-centroid-1): compute each area's centroid from
  // its incidents' real coords instead of stamping every area with the single
  // city centroid (which collapsed all neighborhoods onto one point and broke
  // nearest-area geolocation snapping). Mirrors the per-area-centroid approach
  // used for Indianapolis/Raleigh/Tucson. Incidents whose coords fell back to
  // ATLANTA_CENTROID (missing/0 in the feed) are excluded from the average so
  // they can't drag every area toward downtown.
  const agg = new Map<string, { count: number; latSum: number; lngSum: number; coordN: number }>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    const a = agg.get(r.area) ?? { count: 0, latSum: 0, lngSum: 0, coordN: 0 };
    a.count += 1;
    if (
      typeof r.lat === "number" && typeof r.lng === "number" &&
      !(r.lat === ATLANTA_CENTROID.lat && r.lng === ATLANTA_CENTROID.lng)
    ) {
      a.latSum += r.lat;
      a.lngSum += r.lng;
      a.coordN += 1;
    }
    agg.set(r.area, a);
  }
  return Array.from(agg.entries())
    .filter(([, a]) => a.count >= 1)
    .map(([name, a]) => ({
      slug: `atl-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Atlanta",
      centroid: a.coordN > 0
        ? { lat: a.latSum / a.coordN, lng: a.lngSum / a.coordN }
        : ATLANTA_CENTROID,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// v107 — supersedes the v96 "always AWAIT on cold cache" behaviour. v96 had
// to block (potentially ~45s) because there was no fallback and returning []
// caused a self-perpetuating "windowDays=0 totalCounted=0" degenerate loop.
// Now: (1) the tiered cold load makes the awaited path resolve in a few
// seconds instead of ~45s, and (2) a last-known-good area list (populated by
// any prior successful pull in this pod) is served instantly while a refresh
// runs in the background — the Detroit/Cleveland LKG pattern. So discover
// never blocks on the full fetch and never returns a degenerate empty once the
// pod has warmed even once.
export async function getDiscoveredAreasAtlanta(): Promise<KnownArea[]> {
  if (cache && cache.rows.length > 0) {
    return buildAtlantaAreas(cache.rows);
  }
  if (lastGoodAreas && lastGoodAreas.length > 0) {
    void getRowsAtlanta().catch(() => {});  // refresh in background
    return lastGoodAreas;
  }
  // True cold start (pod has never fetched). Await only the fast recent tier.
  const rows = await getRowsAtlanta().catch(() => [] as Incident[]);
  if (rows.length === 0) return [];
  return buildAtlantaAreas(rows);
}

function labelForAtlSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("atl-") ? s.slice(4) : s;
  for (const r of rows) {
    const cand = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (cand === want) return r.area;
  }
  return null;
}

export const atlantaAdapter: CrimeDataAdapter = {
  isComplete: () => cache?.full ?? false,
  name: "atlanta-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsAtlanta();
    const label = labelForAtlSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [50, 150, 300, 600]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },
  async getIncidents(area, opts) {
    const rows = await getRowsAtlanta();
    const label = labelForAtlSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area, opts) { return this.getIncidents(area, { limit: opts?.limit ?? 20 }); },
};
