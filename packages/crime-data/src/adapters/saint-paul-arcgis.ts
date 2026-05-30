import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { districtNumberToName } from "../data/saint-paul-neighborhoods.js";

// Saint Paul, MN — Saint Paul Police Department Crime Incident Report.
// ArcGIS FeatureServer on services1.arcgis.com (owner: CityofSaintPaul).
//
// SPPD tags every row with NEIGHBORHOOD_NUMBER (the city's 17 District
// Council planning districts) and a clean INCIDENT field with NIBRS-aligned
// labels (Theft, Narcotics, Auto Theft, Burglary, Agg. Assault, Robbery,
// Rape, Criminal Damage, etc.). No demographic columns are published on
// this feed.
//
// SPPD also publishes a meaningful number of administrative "Proactive
// Police Visit" + "Community Event" rows. We drop those at ingest so
// per-neighborhood counts represent actual reported crime.

const BASE = "https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/Crime_Incident_Report_-_Dataset/FeatureServer/0/query";
// v99 — was 2000, but this FeatureServer's maxRecordCount is 1000. The adapter
// stepped the offset by PAGE_SIZE (i × 2000) while each page returned only 1000
// rows, so it fetched rows 0-999, SKIPPED 1000-1999, fetched 2000-2999, etc. —
// silently dropping every other 1000-row block (~half the data, uniformly across
// persons + property). That was the real cause of Saint Paul's 0.41× violent
// rate, NOT feed completeness. Match the server cap so offsets are contiguous.
const PAGE_SIZE = 1000;
// v26 bump 5 → 15. Saint Paul was running ~1.8× under FBI baseline
// on both PERSONS and PROPERTY; deeper cache reduces the
// annualization tax.
const PAGES = 45;  // v99 — 45 × 1000 = 45k contiguous crime rows ≈ 14 months (Saint Paul ~38k crimes/yr after the proactive filter)
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; });

interface SpRow {
  CASE_NUMBER?: number;
  DATE?: number;
  TIME?: number;
  CODE?: number;
  INCIDENT_TYPE?: string;
  INCIDENT?: string;
  POLICE_GRID_NUMBER?: number;
  NEIGHBORHOOD_NUMBER?: number;
  NEIGHBORHOOD_NAME?: string;
  BLOCK?: string;
  CALL_DISPOSITION_CODE?: string;
  CALL_DISPOSITION?: string;
}

function mapToNibrs(incident: string): CrimeCategory | null {
  const t = incident.toUpperCase().trim();
  // Skip administrative/non-crime entries
  if (t.startsWith("PROACTIVE")) return null;
  if (t.startsWith("COMMUNITY EVENT")) return null;
  if (t === "MISC") return null;

  // v99 — ROBBERY moved to PERSONS: FBI UCR Part-1 counts robbery as VIOLENT
  // (it was in the PROPERTY branch, dropping ~6,600 robberies/yr from the
  // citywide violent count). DISCHARGE removed from PERSONS: discharging a
  // firearm is a NIBRS weapons-law (Society) offense, NOT UCR Part-1 violent —
  // it was the largest single PERSONS bucket (~13,655 rows) and was the main
  // thing masking the robbery/agg-domestic under-counts. Aggravated-domestic
  // assault (e.g. "Aggravated Assault, Domestic") is rescued by the
  // /aggravated assault/i Part-1 INCLUDE-OVERRIDE in safety-score.ts.
  if (t.includes("ROBBERY") || t.includes("ASSAULT") || t === "RAPE" ||
      t.includes("HOMICIDE") || t.includes("KIDNAP") || t.includes("DOMESTIC") ||
      t.includes("THREAT") || t.includes("HARASSMENT")) {
    return CrimeCategory.PERSONS;
  }
  if (t === "THEFT" || t === "BURGLARY" || t === "AUTO THEFT" ||
      t.includes("ARSON") || t.includes("CRIMINAL DAMAGE") ||
      t.includes("VANDAL") || t.includes("FRAUD") || t.includes("FORGERY") ||
      t.includes("STOLEN") || t.includes("EMBEZZLE")) {
    return CrimeCategory.PROPERTY;
  }
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "Saint Paul Police Crime Incident Report (City of Saint Paul Open Data, ArcGIS Feature Server)",
  datasetUrl: "https://information.stpaul.gov/datasets/stpaul::crime-incident-report",
  recency: "Refreshed daily by SPPD",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Saint Paul Police Department and aggregated " +
    "to one of 17 District Council planning districts. Administrative entries " +
    "(Proactive Police Visit, Community Event, Misc.) are dropped at ingest. " +
    "Block-level addresses; precise coordinates are not published.",
};

async function fetchPage(offset: number): Promise<SpRow[]> {
  const url = new URL(BASE);
  // v99 — exclude non-crime records at the QUERY level. ~52% of Saint Paul's
  // feed is "Proactive Police Visit" (283k!) + "Community Engagement/Event" +
  // "Proactive Foot Patrol" — all non-crimes the adapter dropped to null
  // post-fetch, so half the 30k-row budget was wasted and only ~14k actual
  // crimes got sampled, under-counting the violent rate to 0.41× FBI. Filtering
  // here doubles the crime density and lengthens the window.
  url.searchParams.set("where", "NEIGHBORHOOD_NUMBER IS NOT NULL AND INCIDENT IS NOT NULL AND INCIDENT NOT LIKE 'Proactive%' AND INCIDENT NOT LIKE 'Community%'");
  url.searchParams.set("outFields", "CASE_NUMBER,DATE,TIME,CODE,INCIDENT_TYPE,INCIDENT,POLICE_GRID_NUMBER,NEIGHBORHOOD_NUMBER,NEIGHBORHOOD_NAME,BLOCK,CALL_DISPOSITION_CODE,CALL_DISPOSITION");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "DATE DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true"); // v87 — Esri edge cache
  url.searchParams.set("f", "json");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
  });
  if (!res.ok) throw new Error(`Saint Paul ArcGIS ${res.status} offset=${offset}`);
  const body = await res.json() as { features?: Array<{ attributes: SpRow }> };
  return (body.features ?? []).map((f) => f.attributes);
}

async function fetchSaintPaul(): Promise<Incident[]> {
  const pages = await Promise.all(
    Array.from({ length: PAGES }, (_, i) => fetchPage(i * PAGE_SIZE).catch(() => [] as SpRow[])),
  );
  const rows = pages.flat();
  const out: Incident[] = [];
  for (const r of rows) {
    const incident = (r.INCIDENT ?? "").trim();
    if (!incident) continue;
    const cat = mapToNibrs(incident);
    if (cat == null) continue;
    // Resolve to canonical polygon name via NEIGHBORHOOD_NUMBER. Fall back to
    // the raw NEIGHBORHOOD_NAME field if the number is missing (rare).
    const num = r.NEIGHBORHOOD_NUMBER;
    const canonical = num != null ? districtNumberToName[String(num)] : undefined;
    const area = canonical
      ?? (r.NEIGHBORHOOD_NAME ?? "").replace(/^\d+\s*-\s*/, "").trim()
      ?? "Unknown";
    if (!area || area === "Unknown") continue;
    out.push({
      id: `sp-${r.CASE_NUMBER ?? out.length}`,
      area,
      occurredAt: r.DATE ? new Date(r.DATE).toISOString() : new Date(0).toISOString(),
      nibrsCategory: cat,
      ibrOffenseDescription: r.INCIDENT_TYPE?.trim() || incident,
      beat: r.POLICE_GRID_NUMBER != null ? `Grid ${r.POLICE_GRID_NUMBER}` : null,
      blockLabel: r.BLOCK ?? undefined,
      // No per-row lat/lng on this feed — neighborhood-level only.
      lat: undefined,
      lng: undefined,
    });
  }
  return out;
}

export async function getRowsSaintPaul(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchSaintPaul();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[sp] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasSaintPaul(): Promise<KnownArea[]> {
  const rows = await getRowsSaintPaul();
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    counts.set(r.area, (counts.get(r.area) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, c]) => c >= 3)
    .map(([name]) => ({
      slug: `sp-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Saint Paul",
      centroid: { lat: 44.95, lng: -93.10 }, // city centroid placeholder
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForSaintPaulSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("sp-") ? s.slice(3) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const saintPaulAdapter: CrimeDataAdapter = {
  name: "saint-paul-arcgis",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsSaintPaul();
    const label = labelForSaintPaulSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [30, 100, 200, 400]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsSaintPaul();
    const label = labelForSaintPaulSlug(area, rows);
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
