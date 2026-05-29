import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT } from "../lib/http.js";

// Indianapolis — IMPD Public Data MapServer layer 1 (Incidents_Public).
// ArcGIS MapServer hosted at gis.indy.gov. Rows carry NIBRSClassDesc and
// lat/lng but NOT a pre-joined neighborhood — we derive via point-in-polygon
// against the city's 99 official neighborhoods at runtime in safety-score.
// For now we expose the geo zones the dataset DOES provide.
// Doc: https://impdtransparency.indy.gov/

const BASE = "https://gis.indy.gov/server/rest/services/IMPD/IMPD_Public_Data/MapServer/1/query";
const PAGE_SIZE = 2000;
const PAGES = 30;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface IndyRow {
  CaseNum?: string;
  sOccDate?: string;
  CR_Desc?: string;
  NIBRSClassDesc?: string;
  NIBRSClassCodeDesc?: string;
  LocationName?: string;
  sAddress?: string;
  sCity?: string;
  Latitude?: number;
  Longitude?: number;
  Geo_Districts?: string;
  Geo_Beats?: string;
  Geo_Zones?: string;
  Geo_Council?: string;
  CADIncidentType?: string;
}

function classify(row: IndyRow): CrimeCategory {
  const desc = `${row.NIBRSClassDesc ?? ""} ${row.NIBRSClassCodeDesc ?? ""} ${row.CR_Desc ?? ""}`.toUpperCase();
  if (/(ASSAULT|BATTERY|ROBBERY|HOMICIDE|MURDER|RAPE|SEX|KIDNAP|STALK|THREAT|INTIMIDAT|DOMESTIC)/.test(desc)) return CrimeCategory.PERSONS;
  if (/(BURGLAR|THEFT|LARC|STOLEN|VANDAL|DAMAGE|ARSON|FRAUD|FORGE|MOTOR VEHICLE)/.test(desc)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const INDY_CENTROID = { lat: 39.7684, lng: -86.1581 };

const PROVENANCE: DataProvenance = {
  source: "Indianapolis Metropolitan Police Department Public Incidents (gis.indy.gov ArcGIS MapServer)",
  datasetUrl: "https://impdtransparency.indy.gov/",
  recency: "Refreshed daily by IMPD",
  granularity: "beat",  // Indy publishes by IMPD district/zone; neighborhood is via PIP overlay client-side
  disclaimer:
    "Incidents are reported by the Indianapolis Metropolitan Police Department and grouped " +
    "by IMPD district. Not live, not street-level. TravelSafe does not track individuals.",
};

async function fetchPage(offset: number): Promise<IndyRow[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", "Latitude IS NOT NULL AND Latitude <> 0");
  url.searchParams.set("outFields", "CaseNum,sOccDate,CR_Desc,NIBRSClassDesc,NIBRSClassCodeDesc,Latitude,Longitude,Geo_Districts,Geo_Beats,Geo_Zones,sAddress");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "OBJECTID DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Indianapolis ArcGIS ${res.status} offset=${offset}`);
  const body = await res.json() as { features?: Array<{ attributes: IndyRow }> };
  return (body.features ?? []).map((f) => f.attributes);
}

async function fetchIndianapolis(): Promise<Incident[]> {
  const results: IndyRow[][] = new Array(PAGES);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PAGES) return;
      results[i] = await fetchPage(i * PAGE_SIZE).catch(() => [] as IndyRow[]);
    }
  });
  await Promise.all(workers);
  const rows = results.flat();
  return rows
    .filter((r) => r.sOccDate)
    .map((r, i) => {
      const area = (r.Geo_Districts ?? "").trim() || (r.Geo_Zones ?? "").trim() || "Unknown";
      return {
        id: `indy-${r.CaseNum ?? i}`,
        area,
        occurredAt: new Date(r.sOccDate!).toISOString(),
        nibrsCategory: classify(r),
        ibrOffenseDescription: (r.NIBRSClassDesc ?? r.NIBRSClassCodeDesc ?? r.CR_Desc ?? "Unknown").trim(),
        beat: r.Geo_Beats ?? null,
        blockLabel: undefined,
        lat: typeof r.Latitude === "number" && r.Latitude !== 0 ? r.Latitude : undefined,
        lng: typeof r.Longitude === "number" && r.Longitude !== 0 ? r.Longitude : undefined,
      };
    });
}

export async function getRowsIndianapolis(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchIndianapolis();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[indy] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasIndianapolis(): Promise<KnownArea[]> {
  const rows = await getRowsIndianapolis();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    // v95p36 — drop "Excluded" placeholder. IMPD's dataset uses this
    // string for incidents the city policy excludes from public
    // mapping (e.g. juvenile, sensitive-location). It is NOT a
    // neighborhood and was surfacing as an area in the catalog.
    if (r.area === "Excluded") continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat; e.lngSum += r.lng; e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 1)
    .map(([name, e]) => ({
      slug: `indy-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Indianapolis",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForIndySlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("indy-") ? s.slice(5) : s;
  for (const r of rows) {
    const cand = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (cand === want) return r.area;
  }
  return null;
}

export const indianapolisAdapter: CrimeDataAdapter = {
  name: "indianapolis-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsIndianapolis();
    const label = labelForIndySlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [100, 400, 800, 1500]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },
  async getIncidents(area, opts) {
    const rows = await getRowsIndianapolis();
    const label = labelForIndySlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area, opts) { return this.getIncidents(area, { limit: opts?.limit ?? 20 }); },
};
