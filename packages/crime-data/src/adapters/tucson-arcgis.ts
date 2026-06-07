import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { deriveBands, bucketByBands } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT, fetchWithRetry, readJson } from "../lib/http.js";

// Tucson — TPD "Reported Crimes" (UCR Part 1), Jan 2017→present.
//
// v108 — switched from the 45-day rolling NEIGHBORHOOD layer
// (PublicMaps/OpenData_PublicSafety/MapServer/42) to the COMPLETE hosted
// "Tucson Police Reported Crimes" table — the backing store for TPD's official
// public dashboard (policeanalysis.tucsonaz.gov). WHY: the 45-day layer carried
// only ~9.5k rows over a 45-day window, so windowDays sat under the 90-day
// confidence floor and Tucson's grade was suppressed to N/A — the documented
// "feed currently partial" limitation. The Reported Crimes table holds ~256k
// Part-1 incidents Jan 2017→present (verified newest 2026-05-02; ~37k in the
// rolling 18-month window across the 6 wards), giving a real multi-year Part-1
// volume and a proper, high-confidence grade.
//
// TRADE-OFF (documented honestly): this table has NO geometry / lat-lng /
// neighborhood — its only geography is Ward (1–6) + Division. So Tucson now
// grades + maps at WARD granularity (6 City of Tucson council wards), the same
// honest coarse-but-complete model as Raleigh's 6 RPD districts, instead of the
// prior ~142 neighborhoods that could not be graded. The table is Part-1-only,
// so no Part-2 filtering is needed.
// Doc: https://gisdata.tucsonaz.gov/datasets/tucson-police-reported-crimes

const BASE = "https://services3.arcgis.com/9coHY2fvuFjG9HQX/arcgis/rest/services/Tucson_Police_Reported_Crimes/FeatureServer/8/query";
const PAGE_SIZE = 2000;
// Rolling ~18-month window: bounds memory (~37k rows verified) while giving the
// annualizer a solid Part-1 sample well past the 90-day confidence floor.
const WINDOW_DAYS = 548;
const PAGES = 40; // 40 × 2k = 80k headroom over the ~37k rows in the window
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; }, "tucson-arcgis");

// Bbox centroids of the 6 City of Tucson council wards, computed from the
// official Ward Boundaries layer (gis.tucsonaz.gov PublicMaps/Boundaries/15).
// The Reported Crimes table is coordless, so these seed the area picker's
// "nearest" lookup and the map's per-ward pin.
const WARD_CENTROID: Record<string, { lat: number; lng: number }> = {
  "Ward 1": { lat: 32.1990, lng: -111.0097 },
  "Ward 2": { lat: 32.2329, lng: -110.8230 },
  "Ward 3": { lat: 32.2783, lng: -110.9715 },
  "Ward 4": { lat: 32.1187, lng: -110.8077 },
  "Ward 5": { lat: 32.1059, lng: -110.8543 },
  "Ward 6": { lat: 32.2275, lng: -110.9146 },
};
const TUCSON_CENTROID = { lat: 32.2226, lng: -110.9747 };

interface TucRow {
  IncidentID?: string;
  DateOccurred?: number | null; // epoch ms
  UCR?: string;                 // "01".."08" (Part-1 only)
  UCRDescription?: string;
  OffenseDescription?: string;
  Ward?: string | number | null;
  Division?: string | null;
}

// UCR Part-1 code → NIBRS three-way bucket. 01 Homicide, 02 Sexual Assault,
// 03 Robbery, 04 Aggravated Assault → violent (PERSONS). 05 Burglary,
// 06 Larceny, 07 Motor-Vehicle Theft, 08 Arson → PROPERTY. The table is
// Part-1-only, so there is no Part-2/SOCIETY noise to filter out.
function classify(row: TucRow): CrimeCategory {
  const code = (row.UCR ?? "").trim().slice(0, 2);
  if (code === "01" || code === "02" || code === "03" || code === "04") return CrimeCategory.PERSONS;
  if (code === "05" || code === "06" || code === "07" || code === "08") return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// Ward 1–6 → "Ward N"; null/blank/other → the honest "Unmapped" bucket (still
// counted citywide, never listed as a selectable area).
function wardLabel(ward: string | number | null | undefined): string {
  const w = String(ward ?? "").trim();
  return /^[1-6]$/.test(w) ? `Ward ${w}` : "Unmapped";
}

const PROVENANCE: DataProvenance = {
  source: "Tucson Police Reported Crimes — UCR Part 1 (City of Tucson Open Data, ArcGIS)",
  datasetUrl: "https://gisdata.tucsonaz.gov/datasets/tucson-police-reported-crimes",
  recency: "UCR Part-1 incidents, Jan 2017–present; refreshed regularly by Tucson PD",
  // "neighborhood" is the app's sub-city-area granularity bucket; Tucson's
  // areas are the 6 council wards (same modeling as Saint Paul's districts).
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Tucson Police Department (UCR Part 1) and grouped " +
    "by City of Tucson council ward (1–6) — this feed carries no neighborhood or " +
    "street-level geography. Not live. CommunitySafe does not track individuals.",
};

async function fetchPage(offset: number, sinceIso: string): Promise<TucRow[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", `DateOccurred >= TIMESTAMP '${sinceIso} 00:00:00'`);
  url.searchParams.set("outFields", "IncidentID,DateOccurred,UCR,UCRDescription,OffenseDescription,Ward,Division");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "DateOccurred DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  // fix(deploy logs): retry undici-level transient "fetch failed" drops.
  const res = await fetchWithRetry(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  if (!res.ok) {
    // Offsets past the windowed row count answer 404/400 — that's end-of-data
    // on a non-first page, not a failure.
    if (offset > 0 && (res.status === 404 || res.status === 400)) return [];
    throw new Error(`Tucson ArcGIS ${res.status} offset=${offset}`);
  }
  const body = await readJson(res) as { features?: Array<{ attributes: TucRow }>; error?: { code?: number; message?: string } };
  if (body.error) throw new Error(`Tucson ArcGIS error ${body.error.code}: ${body.error.message}`);
  return (body.features ?? []).map((f) => f.attributes);
}

async function fetchTucson(): Promise<Incident[]> {
  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const results: TucRow[][] = new Array(PAGES);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PAGES) return;
      const page = await fetchPage(i * PAGE_SIZE, sinceIso).catch((err) => {
        console.warn(`[tuc] page offset=${i * PAGE_SIZE} failed: ${(err as Error).message}`);
        return [] as TucRow[];
      });
      results[i] = page;
      if (page.length === 0) return; // ran past the window
    }
  });
  await Promise.all(workers);
  const rows = results.flat();
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.DateOccurred) continue;
    out.push({
      id: `tuc-${r.IncidentID ?? `idx${i}`}`,
      area: wardLabel(r.Ward),
      occurredAt: new Date(r.DateOccurred).toISOString(),
      nibrsCategory: classify(r),
      ibrOffenseDescription: (r.OffenseDescription ?? r.UCRDescription ?? "Unknown").trim(),
      beat: r.Division ?? null,
      blockLabel: undefined,
      // No per-incident coordinates on this table (Ward-level geography only).
      lat: undefined,
      lng: undefined,
    });
  }
  return out;
}

// v107 — in-flight fetch dedup (the OOM-guard Detroit added in v94): the
// dispatcher fans a per-area Promise.all over every area, so a cold cache
// would otherwise fire N concurrent full fetches. Concurrent callers now
// await the same promise.
let inFlightTucsonFetch: Promise<Incident[]> | null = null;
export async function getRowsTucson(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightTucsonFetch) return inFlightTucsonFetch;
  inFlightTucsonFetch = (async () => {
    try {
      const rows = await fetchTucson();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[tuc] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightTucsonFetch = null;
    }
  })();
  return inFlightTucsonFetch;
}

// perf(tucson-index): the citywide compose calls getAreaStats/getIncidents once
// per ward; each used to scan all ~37k rows (rows.filter + labelForTucSlug +
// riskLevelFromAreaCounts) → O(wards × rows). Mirror Detroit/Saint Paul: build a
// label→rows Map once, memoized by the loader's rows-array identity.
interface TucIndex { rows: Incident[]; labelToRows: Map<string, Incident[]>; slugToLabel: Map<string, string> }
let tucIndex: TucIndex | null = null;
function getTucsonIndex(rows: Incident[]): TucIndex {
  if (tucIndex && tucIndex.rows === rows) return tucIndex;
  const labelToRows = new Map<string, Incident[]>();
  const slugToLabel = new Map<string, string>();
  for (const r of rows) {
    if (!r.area || r.area === "Unmapped") continue;
    let bucket = labelToRows.get(r.area);
    if (!bucket) {
      bucket = [];
      labelToRows.set(r.area, bucket);
      slugToLabel.set(r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), r.area);
    }
    bucket.push(r);
  }
  tucIndex = { rows, labelToRows, slugToLabel };
  return tucIndex;
}

export async function getDiscoveredAreasTucson(): Promise<KnownArea[]> {
  const rows = await getRowsTucson();
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.area || r.area === "Unmapped") continue;
    counts.set(r.area, (counts.get(r.area) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, n]) => n >= 1)
    .map(([label]) => ({
      slug: `tuc-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label,
      jurisdiction: "Tucson",
      centroid: WARD_CENTROID[label] ?? TUCSON_CENTROID,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForTucSlug(slug: string, index: TucIndex): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("tuc-") ? s.slice(4) : s;
  return index.slugToLabel.get(want) ?? null;
}

export const tucsonAdapter: CrimeDataAdapter = {
  name: "tucson-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const index = getTucsonIndex(await getRowsTucson());
    const label = labelForTucSlug(area, index);
    if (!label) return null;
    const inArea = index.labelToRows.get(label) ?? [];
    if (inArea.length === 0) return null;
    // Ward buckets are large (city/6); deriveBands self-calibrates over the 6
    // wards' own distribution, degrading to the scaled static thresholds.
    // Equivalent to the prior riskLevelFromAreaCounts but without re-scanning.
    const dist = [...index.labelToRows.values()].map((g) => g.length).filter((n) => n >= 3);
    const riskLevel = bucketByBands(inArea.length, deriveBands(dist, [2000, 4000, 6000, 9000]));
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },
  async getIncidents(area, opts) {
    const index = getTucsonIndex(await getRowsTucson());
    const label = labelForTucSlug(area, index);
    if (!label) return [];
    let filtered = index.labelToRows.get(label) ?? [];
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    else filtered = [...filtered];
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area, opts) { return this.getIncidents(area, { limit: opts?.limit ?? 20 }); },
};
