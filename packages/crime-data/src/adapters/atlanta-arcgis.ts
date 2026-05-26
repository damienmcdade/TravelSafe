import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
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
  if (/(ASSAULT|BATTERY|ROBBERY|HOMICIDE|MURDER|MANSLAUGHTER|RAPE|SEX|KIDNAP|STALK|THREAT|INTIMIDAT|DOMESTIC)/.test(desc)) return CrimeCategory.PERSONS;
  if (/(BURGLAR|THEFT|LARC|STOLEN|VANDAL|DAMAGE|ARSON|FRAUD|FORGE|MOTOR VEHICLE|EMBEZ|COUNTERFEIT|SHOPLIFT)/.test(desc)) return CrimeCategory.PROPERTY;
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
  url.searchParams.set("orderByFields", "OBJECTID DESC");
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
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    counts.set(r.area, (counts.get(r.area) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, n]) => n >= 1)
    .map(([name]) => ({
      slug: `atl-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Atlanta",
      centroid: ATLANTA_CENTROID,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// LKG pattern — return cached if any, fire refresh + return [] otherwise.
// Warm-worker populates within ~30s of container boot.
export async function getDiscoveredAreasAtlanta(): Promise<KnownArea[]> {
  if (cache && cache.rows.length > 0) {
    return buildAtlantaAreas(cache.rows);
  }
  void getRowsAtlanta().catch(() => {});
  return [];
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
    const riskLevel: 1|2|3|4|5 = inArea.length > 600 ? 5 : inArea.length > 300 ? 4 : inArea.length > 150 ? 3 : inArea.length > 50 ? 2 : 1;
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
