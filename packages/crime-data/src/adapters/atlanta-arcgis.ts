import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT } from "../lib/http.js";

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
const PAGES = 30;  // ~60k recent incidents — covers ~90-180d of APD volume
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
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
  const body = await res.json() as { features?: Array<{ attributes: AtlRow }> };
  return (body.features ?? []).map((f) => f.attributes);
}

async function fetchAtlanta(): Promise<Incident[]> {
  const results: AtlRow[][] = new Array(PAGES);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PAGES) return;
      results[i] = await fetchPage(i * PAGE_SIZE).catch(() => [] as AtlRow[]);
    }
  });
  await Promise.all(workers);
  const rows = results.flat();
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

export async function getRowsAtlanta(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchAtlanta();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[atl] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
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

// v96 — fire-and-forget on cold cache produced a persistent
// "windowDays=0 totalCounted=0" degenerate result for Atlanta on every
// warm-worker cycle: discover returned [] → safety-score iterated 0
// areas → wrote no rows → next cycle hit the same empty cache, repeat.
// Without a STATIC_<city>_AREAS fallback (Phoenix has one; Atlanta does
// not), the only correct answer is to AWAIT the row fetch on cold cache.
// The user-facing cost is a single ~5-30 s blocking call on a true
// cold-start (no warm-worker has run yet); the warm-worker runs every
// 4 min, so steady-state requests always see warm cache.
export async function getDiscoveredAreasAtlanta(): Promise<KnownArea[]> {
  if (cache && cache.rows.length > 0) {
    return buildAtlantaAreas(cache.rows);
  }
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
