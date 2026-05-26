import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT } from "../lib/http.js";

// Atlanta — Atlanta PD Crimes (public).
// ArcGIS FeatureServer on services.arcgis.com (owner: Atlanta Police Open Data Hub).
// Rows carry both an NPU letter (A-Z) and a neighborhood name; we aggregate
// by neighborhood since the 25 NPUs are an additional coarser grouping.
// Doc: https://atlanta-police-opendata-atlantapd.hub.arcgis.com/

const BASE = "https://services.arcgis.com/aJ16ENn1AaqdFlqx/ArcGIS/rest/services/Crimes_public_c4e5a6ee960c4710b634386c8c034aa7/FeatureServer/0/query";
const PAGE_SIZE = 2000;
const PAGES = 20;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface AtlRow {
  offenseid?: string;
  reportdate?: number;
  offendatefr?: number;
  neighborhood?: string;
  ucrcategory?: string;
  ucrdesc?: string;
  nibrsdesc?: string;
  nibrscrimeag?: string;
  lawdistrict?: string;
  localdistrict?: string;
  zip5?: string;
}

function classify(row: AtlRow): CrimeCategory {
  const ag = (row.nibrscrimeag ?? "").toLowerCase();
  if (ag.includes("person")) return CrimeCategory.PERSONS;
  if (ag.includes("property")) return CrimeCategory.PROPERTY;
  // Fall back to UCR category for rows without nibrscrimeag
  const ucr = `${row.ucrcategory ?? ""} ${row.ucrdesc ?? ""}`.toUpperCase();
  if (/(ASSAULT|ROBBERY|HOMICIDE|MURDER|RAPE|SEX)/.test(ucr)) return CrimeCategory.PERSONS;
  if (/(BURGLAR|THEFT|LARC|STOLEN|VANDAL|FRAUD|ARSON)/.test(ucr)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const ATLANTA_CENTROID = { lat: 33.7490, lng: -84.3880 };

const PROVENANCE: DataProvenance = {
  source: "Atlanta Police Department Crimes (Public) — Atlanta Police Open Data Hub (ArcGIS Feature Server)",
  datasetUrl: "https://atlanta-police-opendata-atlantapd.hub.arcgis.com/",
  recency: "Refreshed daily by Atlanta PD",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Atlanta Police Department and grouped by neighborhood. " +
    "Not live, not street-level. CommunitySafe does not track individuals.",
};

async function fetchPage(offset: number): Promise<AtlRow[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", "neighborhood IS NOT NULL AND neighborhood <> ''");
  url.searchParams.set("outFields", "offenseid,reportdate,offendatefr,neighborhood,ucrcategory,ucrdesc,nibrsdesc,nibrscrimeag,lawdistrict,localdistrict,zip5");
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
    .filter((r) => (r.offendatefr || r.reportdate) && r.neighborhood)
    .map((r, i) => ({
      id: `atl-${r.offenseid ?? i}`,
      area: r.neighborhood!,
      occurredAt: new Date(r.offendatefr ?? r.reportdate!).toISOString(),
      nibrsCategory: classify(r),
      ibrOffenseDescription: (r.nibrsdesc ?? r.ucrdesc ?? r.ucrcategory ?? "Unknown").trim(),
      beat: r.localdistrict ?? r.lawdistrict ?? null,
      blockLabel: undefined,
      lat: ATLANTA_CENTROID.lat,
      lng: ATLANTA_CENTROID.lng,
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

export async function getDiscoveredAreasAtlanta(): Promise<KnownArea[]> {
  const rows = await getRowsAtlanta();
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
