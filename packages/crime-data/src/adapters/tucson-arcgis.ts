import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT } from "../lib/http.js";

// Tucson — TPD Incidents Public (2025).
// ArcGIS MapServer on gis.tucsonaz.gov. Rows carry NEIGHBORHD (pre-joined),
// UCRSummary, LAT/LONG, OFFENSE, and DATE_OCCU. We use the pre-joined
// neighborhood field directly so no PIP at intake.
// Doc: https://gisdata.tucsonaz.gov/

// v95p6 — switched from MapServer/81 (TPD_INCIDENTS_PUBLIC_2025,
// year-specific layer) to MapServer/42 (TUCSON_INCIDENTS_PUBLIC_45D,
// the 45-day rolling layer). The 2025 layer stopped returning fresh
// rows in our audit window (newest sortable row was 2025-09-22 with
// only a single PERSONS row reaching the cache), which tripped the
// under-count guard and suppressed Tucson's grade to N/A. The 45D
// layer is the live rolling feed used by Tucson's own dashboards;
// it carries the same schema (NHA_NAME, NEIGHBORHD, DATETIME_OCCU)
// and was verified fresh through 2026-05-22 with 9.5k rows across
// 142 named neighborhoods.
//
// Trade-off: windowDays is bounded by ~45d, which trips the
// computeDataConfidence "low confidence" note (under 90d). That's
// the honest signal — we have a short-but-current window — and is
// preferable to the prior state of grading off a fossilized full-
// year layer that had effectively zero recent data.
const BASE = "https://gis.tucsonaz.gov/arcgis/rest/services/PublicMaps/OpenData_PublicSafety/MapServer/42/query";
const PAGE_SIZE = 2000;
// 6 pages × 2k = 12k records — comfortably exceeds the live layer's
// ~9.5k 45-day capacity, so we get everything in the rolling window.
const PAGES = 6;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface TucRow {
  INCI_ID?: string;
  // Layer 42 (45D rolling) leaves DATE_OCCU null and uses
  // DATETIME_OCCU as the only populated timestamp. Layer 81 (year-
  // specific) populated both. Adapter reads DATETIME_OCCU first,
  // falls back to DATE_OCCU so a future layer switch back is safe.
  DATE_OCCU?: number | null;
  DATETIME_OCCU?: number | null;
  UCRSummary?: string;
  UCRSummaryDesc?: string;
  OFFENSE?: string;
  STATUTDESC?: string;
  CrimeCategory?: string;
  CrimeType?: string;
  NEIGHBORHD?: string;  // TPD short code like "T206"
  NHA_NAME?: string;    // display name like "Eastside"
  emdivision?: string;
  DIVISION?: string;
  WARD?: string;
  LAT?: number;
  LONG?: number;
  X?: number;
  Y?: number;
}

function classify(row: TucRow): CrimeCategory {
  const cat = `${row.CrimeCategory ?? ""} ${row.CrimeType ?? ""}`.toLowerCase();
  if (cat.includes("person") || cat.includes("violent")) return CrimeCategory.PERSONS;
  if (cat.includes("property")) return CrimeCategory.PROPERTY;
  const desc = `${row.OFFENSE ?? ""} ${row.UCRSummaryDesc ?? ""} ${row.STATUTDESC ?? ""}`.toUpperCase();
  if (/(ASSAULT|BATTERY|ROBBERY|HOMICIDE|MURDER|RAPE|SEX|KIDNAP|STALK|THREAT)/.test(desc)) return CrimeCategory.PERSONS;
  if (/(BURGLAR|THEFT|LARC|STOLEN|VANDAL|ARSON|FRAUD|MOTOR VEHICLE)/.test(desc)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const TUCSON_CENTROID = { lat: 32.2226, lng: -110.9747 };

const PROVENANCE: DataProvenance = {
  source: "Tucson Police Incidents — Last 45 Days (gis.tucsonaz.gov ArcGIS MapServer)",
  datasetUrl: "https://gisdata.tucsonaz.gov/datasets/tpd-incidents-public-last-45-days",
  recency: "Rolling 45-day window, refreshed daily by Tucson PD",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Tucson Police Department and grouped by NEIGHBORHD. " +
    "Not live, not street-level. CommunitySafe does not track individuals.",
};

async function fetchPage(offset: number): Promise<TucRow[]> {
  const url = new URL(BASE);
  // Layer 42 populates DATETIME_OCCU (epoch ms) and leaves DATE_OCCU
  // null; filter on the populated field so we don't drop every row.
  url.searchParams.set("where", "DATETIME_OCCU IS NOT NULL");
  url.searchParams.set("outFields", "INCI_ID,DATE_OCCU,DATETIME_OCCU,UCRSummary,UCRSummaryDesc,OFFENSE,STATUTDESC,CrimeCategory,CrimeType,NHA_NAME,NEIGHBORHD,emdivision,DIVISION,WARD,LAT,LONG,X,Y");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "OBJECTID DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Tucson ArcGIS ${res.status} offset=${offset}`);
  const body = await res.json() as { features?: Array<{ attributes: TucRow }> };
  return (body.features ?? []).map((f) => f.attributes);
}

async function fetchTucson(): Promise<Incident[]> {
  const results: TucRow[][] = new Array(PAGES);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PAGES) return;
      results[i] = await fetchPage(i * PAGE_SIZE).catch(() => [] as TucRow[]);
    }
  });
  await Promise.all(workers);
  const rows = results.flat();
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // Prefer DATETIME_OCCU (layer 42), fall back to DATE_OCCU (any
    // year-specific layer if we ever re-add one).
    const ts = r.DATETIME_OCCU ?? r.DATE_OCCU;
    if (!ts) continue;
    out.push({
      id: `tuc-${r.INCI_ID ?? i}`,
      // Prefer NHA_NAME (display name matches polygon file); fall
      // back to NEIGHBORHD code when NHA_NAME is missing.
      area: (r.NHA_NAME && r.NHA_NAME.trim()) || (r.NEIGHBORHD ?? "Unknown"),
      occurredAt: new Date(ts).toISOString(),
      nibrsCategory: classify(r),
      ibrOffenseDescription: (r.OFFENSE ?? r.UCRSummaryDesc ?? r.STATUTDESC ?? "Unknown").trim(),
      beat: r.emdivision ?? r.DIVISION ?? r.WARD ?? null,
      blockLabel: undefined,
      // Layer 42 returns coords as LAT/LONG OR X/Y depending on
      // outSR; accept either so we don't lose discovery.
      lat: typeof r.LAT === "number" && r.LAT !== 0 ? r.LAT
        : typeof r.Y === "number" && r.Y !== 0 ? r.Y
        : undefined,
      lng: typeof r.LONG === "number" && r.LONG !== 0 ? r.LONG
        : typeof r.X === "number" && r.X !== 0 ? r.X
        : undefined,
    });
  }
  return out;
}

export async function getRowsTucson(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchTucson();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[tuc] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasTucson(): Promise<KnownArea[]> {
  const rows = await getRowsTucson();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat; e.lngSum += r.lng; e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 1)
    .map(([name, e]) => ({
      slug: `tuc-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Tucson",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForTucSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("tuc-") ? s.slice(4) : s;
  for (const r of rows) {
    const cand = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (cand === want) return r.area;
  }
  return null;
}

export const tucsonAdapter: CrimeDataAdapter = {
  name: "tucson-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsTucson();
    const label = labelForTucSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1|2|3|4|5 = inArea.length > 800 ? 5 : inArea.length > 400 ? 4 : inArea.length > 150 ? 3 : inArea.length > 50 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },
  async getIncidents(area, opts) {
    const rows = await getRowsTucson();
    const label = labelForTucSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area, opts) { return this.getIncidents(area, { limit: opts?.limit ?? 20 }); },
};
