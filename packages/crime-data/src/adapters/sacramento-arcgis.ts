import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT } from "../lib/http.js";

// Sacramento — Sacramento PD Report Data (current year).
// ArcGIS FeatureServer on services5.arcgis.com (owner: City of Sacramento).
// The dataset publishes per-incident rows with a `Neighborhood_Association`
// column pre-joined — no point-in-polygon geocoding needed at intake.
// Doc: https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/Sacramento_Report_Data_2025/FeatureServer/0

// Sacramento publishes year-specific datasets that get a fresh URL
// each Jan; ALSO publishes a 3-year rolling view but that one lacks
// the Neighborhood_Association column. Fetch BOTH year-specific
// datasets (current + prior) in parallel and merge — same pattern
// LA uses for k7nn-b2ep (current) + y8y3-fqfu (historical).
const BASE_2026 = "https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/Sacramento_Report_Data_2026/FeatureServer/0/query";
const BASE_2025 = "https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/Sacramento_Report_Data_2025/FeatureServer/0/query";
const PAGE_SIZE = 2000;
const PAGES = 30;  // ~60k incidents covers full Sacramento PD annual volume
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface SacRow {
  Record_ID?: string;
  Occurrence_Date_PT?: number;
  Offense_Category?: string;
  Description?: string;
  Police_District?: string;
  Beat?: string;
  Neighborhood_Association?: string;
}

const PERSONS_KEYWORDS = [
  "ASSAULT", "BATTERY", "ROBBERY", "HOMICIDE", "MURDER", "MANSLAUGHTER",
  "RAPE", "SEX OFFENSE", "SEXUAL", "KIDNAP", "ABDUCTION",
  "DOMESTIC", "FAMILY VIOLENCE", "STALK", "THREAT", "INTIMIDAT",
];
const PROPERTY_KEYWORDS = [
  "BURGLAR", "THEFT", "STOLEN", "LARCENY", "GTA", "VEHICLE THEFT",
  "VANDALISM", "DAMAGE", "ARSON", "FRAUD", "FORGERY", "EMBEZZLE", "SHOPLIFT",
];
function classify(row: SacRow): CrimeCategory {
  const t = `${row.Offense_Category ?? ""} ${row.Description ?? ""}`.toUpperCase();
  for (const k of PERSONS_KEYWORDS) if (t.includes(k)) return CrimeCategory.PERSONS;
  for (const k of PROPERTY_KEYWORDS) if (t.includes(k)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const SACRAMENTO_CENTROID = { lat: 38.5816, lng: -121.4944 };

const PROVENANCE: DataProvenance = {
  source: "City of Sacramento Report Data (Sacramento PD via Sacramento Open Data, ArcGIS Feature Server)",
  datasetUrl: "https://data.cityofsacramento.org/datasets/sacramento-report-data",
  recency: "Refreshed daily by Sacramento PD",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Sacramento Police Department and grouped by Sacramento " +
    "Neighborhood Association. Not live, not street-level. CommunitySafe does not track individuals.",
};

async function fetchPage(baseUrl: string, offset: number): Promise<SacRow[]> {
  const url = new URL(baseUrl);
  url.searchParams.set("where", "Neighborhood_Association IS NOT NULL AND Neighborhood_Association <> ''");
  url.searchParams.set("outFields", "Record_ID,Occurrence_Date_PT,Offense_Category,Description,Police_District,Beat,Neighborhood_Association");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "OBJECTID DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Sacramento ArcGIS ${res.status} offset=${offset}`);
  const body = await res.json() as { features?: Array<{ attributes: SacRow }> };
  return (body.features ?? []).map((f) => f.attributes);
}

async function fetchDataset(baseUrl: string): Promise<SacRow[]> {
  // Bounded concurrency=4 — same pattern as Cleveland/LV to avoid
  // rate-limiting the upstream ArcGIS tenant.
  const results: SacRow[][] = new Array(PAGES);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PAGES) return;
      results[i] = await fetchPage(baseUrl, i * PAGE_SIZE).catch(() => [] as SacRow[]);
    }
  });
  await Promise.all(workers);
  return results.flat();
}

async function fetchSacramento(): Promise<Incident[]> {
  // Pull current + prior year datasets in parallel and dedupe on
  // Record_ID. When the 2026 dataset is empty (Sacramento publishes
  // a fresh empty dataset at year start and fills it over time)
  // we still get useful coverage from 2025.
  const [current, prior] = await Promise.all([
    fetchDataset(BASE_2026).catch(() => [] as SacRow[]),
    fetchDataset(BASE_2025).catch(() => [] as SacRow[]),
  ]);
  const seen = new Set<string>();
  const merged: SacRow[] = [];
  for (const r of [...current, ...prior]) {
    const key = r.Record_ID ?? "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }
  return merged
    .filter((r) => r.Occurrence_Date_PT && r.Neighborhood_Association)
    .map((r, i) => {
      // Neighborhood_Association is a semicolon-separated list of
      // overlapping neighborhood associations (a single address can
      // sit inside 2-5 associations). Take the first — it's the
      // primary association in the city's data dictionary.
      const primaryArea = r.Neighborhood_Association!.split(";")[0].trim();
      return {
        id: `sac-${r.Record_ID ?? i}`,
        area: primaryArea,
        occurredAt: new Date(r.Occurrence_Date_PT!).toISOString(),
        nibrsCategory: classify(r),
        ibrOffenseDescription: (r.Description ?? r.Offense_Category ?? "Unknown").trim(),
        beat: r.Beat ?? r.Police_District ?? null,
        blockLabel: undefined,
        lat: SACRAMENTO_CENTROID.lat,
        lng: SACRAMENTO_CENTROID.lng,
      };
    });
}

export async function getRowsSacramento(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchSacramento();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[sac] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasSacramento(): Promise<KnownArea[]> {
  const rows = await getRowsSacramento();
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    counts.set(r.area, (counts.get(r.area) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, n]) => n >= 1)
    .map(([name]) => ({
      slug: `sac-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Sacramento",
      centroid: SACRAMENTO_CENTROID,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForSacSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("sac-") ? s.slice(4) : s;
  for (const r of rows) {
    const cand = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (cand === want) return r.area;
  }
  return null;
}

export const sacramentoAdapter: CrimeDataAdapter = {
  name: "sacramento-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsSacramento();
    const label = labelForSacSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1|2|3|4|5 = inArea.length > 600 ? 5 : inArea.length > 300 ? 4 : inArea.length > 150 ? 3 : inArea.length > 50 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },
  async getIncidents(area, opts) {
    const rows = await getRowsSacramento();
    const label = labelForSacSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area, opts) {
    return this.getIncidents(area, { limit: opts?.limit ?? 20 });
  },
};
