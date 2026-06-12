import { CrimeCategory } from "../crime-category.js";
import { readJson } from "../lib/http.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { createTieredLoader } from "../lib/tiered-loader.js";
import { deriveBands, bucketByBands } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { districtNumberToName } from "../data/saint-paul-neighborhoods.js";
import { GENERATED_AREA_CENTROIDS } from "../area-centroids-generated.js";

// fix(audit cities-saint-paul-centroid-collapse): SPPD's feed has no per-row
// coords, so every district used to get the citywide placeholder and the map
// collapsed all 17 onto downtown. Resolve each to the real centroid of its
// District Council polygon (saint-paul.geojson via build-area-centroids).
const SP_CENTROIDS = GENERATED_AREA_CENTROIDS["saint-paul"] ?? {};
const SP_CITY_CENTROID = { lat: 44.95, lng: -93.10 };

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
// v108 — tiered cold load (see lib/tiered-loader): serve the most-recent
// RECENT_PAGES fast, backfill the rest in the background.
const RECENT_PAGES = 8;

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
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Saint Paul ArcGIS ${res.status} offset=${offset}`);
  const body = await readJson(res) as { features?: Array<{ attributes: SpRow }>; error?: unknown };
  // fix(audit data-sev1): ArcGIS returns HTTP 200 with an embedded
  // {error:{code:499 Token Required,...}} when a layer goes private/
  // token-gated. Without this guard that maps to 0 rows and grades the
  // whole city as zero-crime ("100/safe"). Throw so the dispatcher
  // serves last-known-good instead of a fabricated zero.
  if (body.error) throw new Error(`Saint Paul ArcGIS body error offset=${offset}`);
  return (body.features ?? []).map((f) => f.attributes);
}

function mapSaintPaul(rows: SpRow[], baseIndex: number): Incident[] {
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
      id: `sp-${r.CASE_NUMBER ?? `idx${baseIndex + out.length}`}`,
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

// Fetch the half-open page range [startPage, endPage) with bounded concurrency
// (4) — v108: was a single Promise.all over all 45 pages at once (an unbounded
// burst); bounding it avoids rate-limiting the ArcGIS tenant. A page failure
// degrades to [] and marks the range incomplete.
async function fetchRangeSaintPaul(startPage: number, endPage: number): Promise<{ rows: Incident[]; complete: boolean }> {
  const count = endPage - startPage;
  const results: SpRow[][] = new Array(count);
  let cursor = 0;
  let failures = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= count) return;
      results[i] = await fetchPage((startPage + i) * PAGE_SIZE).catch(() => { failures++; return [] as SpRow[]; });
    }
  });
  await Promise.all(workers);
  return { rows: mapSaintPaul(results.flat(), startPage * PAGE_SIZE), complete: failures === 0 };
}

const saintPaulLoader = createTieredLoader({
  name: "saint-paul-arcgis",
  recentPages: RECENT_PAGES,
  pages: PAGES,
  fetchRange: fetchRangeSaintPaul,
});
export async function getRowsSaintPaul(): Promise<Incident[]> {
  return saintPaulLoader.getRows();
}

// perf(saint-paul-index): the citywide compose path calls getAreaStats /
// getIncidents once per district (17 areas), and each call used to scan all
// ~45k rows (rows.filter + a full re-scan inside labelForSaintPaulSlug and
// riskLevelFromAreaCounts) → O(areas × rows). Mirror Detroit's labelToRows:
// build a label → Incident[] Map once, memoized by the rows-array identity
// returned by the tiered loader, and rebuild only when that array changes
// (i.e. the background deep-load swaps in a larger array).
interface SpIndex {
  rows: Incident[];
  labelToRows: Map<string, Incident[]>;
  slugToLabel: Map<string, string>;
}
let spIndex: SpIndex | null = null;
function getSaintPaulIndex(rows: Incident[]): SpIndex {
  if (spIndex && spIndex.rows === rows) return spIndex;
  const labelToRows = new Map<string, Incident[]>();
  const slugToLabel = new Map<string, string>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    let bucket = labelToRows.get(r.area);
    if (!bucket) {
      bucket = [];
      labelToRows.set(r.area, bucket);
      const slug = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      slugToLabel.set(slug, r.area);
    }
    bucket.push(r);
  }
  spIndex = { rows, labelToRows, slugToLabel };
  return spIndex;
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
    .map(([name]) => {
      const slug = `sp-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
      return {
        slug,
        label: name,
        jurisdiction: "Saint Paul",
        centroid: SP_CENTROIDS[slug] ?? { ...SP_CITY_CENTROID },
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForSaintPaulSlug(slug: string, index: SpIndex): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("sp-") ? s.slice(3) : s;
  return index.slugToLabel.get(want) ?? null;
}

export const saintPaulAdapter: CrimeDataAdapter = {
  isComplete: () => saintPaulLoader.complete(),
  name: "saint-paul-arcgis",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const index = getSaintPaulIndex(await getRowsSaintPaul());
    const label = labelForSaintPaulSlug(area, index);
    if (!label) return null;
    const inArea = index.labelToRows.get(label) ?? [];
    if (inArea.length === 0) return null;
    // Self-calibrating quintile bands over this city's own per-area
    // distribution (the indexed bucket sizes, floored at 3 to ignore stray
    // geocodes); degrades to the prior hand-tuned thresholds. Equivalent to
    // the prior riskLevelFromAreaCounts(rows, …) but without re-scanning rows.
    const dist = [...index.labelToRows.values()].map((g) => g.length).filter((n) => n >= 3);
    const riskLevel = bucketByBands(inArea.length, deriveBands(dist, [30, 100, 200, 400]));
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const index = getSaintPaulIndex(await getRowsSaintPaul());
    const label = labelForSaintPaulSlug(area, index);
    if (!label) return [];
    // The index bucket is shared/cached — copy before sorting so we never
    // mutate it in place.
    let filtered = index.labelToRows.get(label) ?? [];
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    else filtered = [...filtered];
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },

  async getRecentReports(area: string, opts?: { limit?: number }) {
    return this.getIncidents(area, { limit: opts?.limit ?? 20 });
  },
};
