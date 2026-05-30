import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
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
// v98 — the 2026 dataset was published with SPACES in its service name
// ("Sacramento Report Data 2026"), unlike every prior year's underscore
// form. The old underscore URL 400'd ("Invalid URL"), so the adapter
// silently served only stale 2025 data (the full-fleet audit flagged
// Sacramento as 149d stale + grade N/A). URL-encode the spaces; the 2026
// service is live with the same Neighborhood_Association schema (20k+ rows).
const BASE_2026 = "https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/Sacramento%20Report%20Data%202026/FeatureServer/0/query";
const BASE_2025 = "https://services5.arcgis.com/54falWtcpty3V47Z/arcgis/rest/services/Sacramento_Report_Data_2025/FeatureServer/0/query";
const PAGE_SIZE = 2000;
const PAGES = 30;  // ~60k incidents covers full Sacramento PD annual volume
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; });

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
  const desc = (row.Description ?? "").trim().toUpperCase();
  // v99 — over-count fix. Sacramento's Description leads with the California
  // Penal Code. The coarse "ASSAULT" Offense_Category lumps simple + aggravated
  // together (57% of it is simple), so keyword-only classification counted
  // every assault as FBI Part-1 violent (rate ran 1.82× FBI). Route the SIMPLE
  // penal codes to SOCIETY so they don't inflate the violent count:
  //   240 simple assault · 241 assault on officer · 242 simple battery ·
  //   243 battery variants (243(E)(1) simple DV battery, 243(B) officer, etc.)
  //   EXCEPT 243(D) serious-bodily-injury battery and 243.4 sexual battery.
  // AGGRAVATED codes stay PERSONS via the keyword pass: 245 ADW, 244 caustic,
  // 244.5 taser, 246 firearm-at-dwelling, 273.5 corporal injury on spouse,
  // 220 assault-with-intent, 664/187 attempted murder.
  if (/^\s*24[012]\b/.test(desc) || /^\s*243(?!\(D\)|\.4)/.test(desc)) {
    return CrimeCategory.SOCIETY;
  }
  const t = `${row.Offense_Category ?? ""} ${desc}`;
  for (const k of PERSONS_KEYWORDS) if (t.includes(k)) return CrimeCategory.PERSONS;
  for (const k of PROPERTY_KEYWORDS) if (t.includes(k)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const SACRAMENTO_CENTROID = { lat: 38.5816, lng: -121.4944 };

// v95p34 — Sacramento's upstream `Neighborhood_Association` column is
// the city's roster of community + business-improvement-district orgs.
// The raw values are unrecognizable as neighborhood names:
//   "Folsom Boulevard Alliance (PBID)"
//   "Franklin Boulevard Business Association (PBID)"
//   "Hagginwood Community Association (HCA)"
//   "Harmon Johnson Neighborhood Association"
// Users say "Folsom Boulevard", not "Folsom Boulevard Alliance PBID".
// Trim the org-suffix tail so the displayed label is the place itself.
//
// Also: one row in the live dataset arrives UTF-16 mis-encoded as UTF-8
// (every other byte is \x00) — the "Hagginwood Community Association
// (HCA)" duplicate. Strip null bytes at intake.
const SAC_TRAILING_SUFFIXES = [
  /\s+\(PBID\)\s*$/i,
  /\s+\(BID\)\s*$/i,
  /\s+\(HCA\)\s*$/i,
  /\s+\(ESP\)\s*$/i,
  /\s+Business Association\s*$/i,
  /\s+Community Association\s*$/i,
  /\s+Neighborhood Association\s*$/i,
  /\s+Chamber Of Commerce\s*$/i,
  /\s+Partnership\s*$/i,
  /\s+Alliance\s*$/i,
  /\s+Preservation\s*$/i,
  // v99 — generic tails the specific patterns above miss. A trailing
  // parenthetical acronym ("Oak Park Neighborhood Association (OPNA)")
  // and a bare "Association" suffix ("Midtown Association"). The cleaner
  // loops, so "(OPNA)" is stripped first, then "Neighborhood Association"
  // collapses "Oak Park Neighborhood Association (OPNA)" → "Oak Park".
  /\s+\([A-Za-z0-9.&'-]+\)\s*$/,
  /\s+Association\s*$/i,
];
// Manual overrides for edge cases the suffix-stripper can't cleanly
// resolve. Empty-string => drop the entry from getDiscoveredAreas.
const SAC_LABEL_OVERRIDES: Record<string, string> = {
  "east sac give back": "", // a charity, not a place
  "preservation sacramento": "", // citywide preservation society, not a neighborhood
};

function cleanSacLabel(raw: string): string {
  if (!raw) return "";
  // Strip null bytes (the UTF-16 mis-encoding case).
  // eslint-disable-next-line no-control-regex
  let s = raw.replace(new RegExp(String.fromCharCode(0), "g"), "").trim();
  // Collapse double-spaces left over from removed chars.
  s = s.replace(/\s+/g, " ");
  // Apply manual overrides (case-insensitive on the pre-trim value).
  const override = SAC_LABEL_OVERRIDES[s.toLowerCase()];
  if (override !== undefined) return override;
  // Strip known org-suffix tails. Loop because some labels carry
  // multiple ("Alliance (PBID)" → trim "(PBID)" then "Alliance").
  let prev = "";
  while (s !== prev) {
    prev = s;
    for (const rx of SAC_TRAILING_SUFFIXES) s = s.replace(rx, "").trim();
  }
  return s;
}

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
  url.searchParams.set("orderByFields", "Occurrence_Date_PT DESC");
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
      // sit inside 2-5 associations).
      //
      // v99 — DO NOT just take split(";")[0]. The city lists the
      // citywide umbrella org "Preservation Sacramento" (and a handful
      // of other non-place orgs) FIRST in the vast majority of rows, so
      // taking element [0] then dropping citywide orgs sent ~75% of all
      // incidents to "Unknown". Those Unknown rows vanish from
      // getDiscoveredAreas AND from the citywide safety-score (which sums
      // only over discovered areas) — which is why only ~10 neighborhoods
      // surfaced and the score read 0.23× the FBI baseline, tripping the
      // divergence guard to grade=N/A. Instead, clean EVERY association
      // in the list and take the first that survives cleaning (citywide
      // orgs clean to "" and are skipped), so each incident lands on its
      // first real neighborhood. Rows whose only association is a
      // citywide org stay "Unknown" (correctly unplaceable).
      const cleaned = r.Neighborhood_Association!
        .split(";")
        .map((a) => cleanSacLabel(a.trim()))
        .find((a) => a.length > 0) ?? "";
      return {
        id: `sac-${r.Record_ID ?? i}`,
        // Use the cleaned, user-friendly neighborhood label. Empty
        // string from cleanSacLabel means "drop" (charity / citywide
        // org) — we mark the row as Unknown so it doesn't appear as
        // an unrecognizable area.
        area: cleaned || "Unknown",
        // Occurrence_Date_PT arrives as ArcGIS ms-since-epoch. ArcGIS
        // Online normalizes datetimes to UTC at storage time, so the
        // raw ms value should already be a true UTC instant despite
        // the "_PT" suffix (which names the dataset author's intent,
        // not the wire format). Leaving as-is pending end-to-end
        // verification against a known incident; if that check shows
        // the ms is actually PT-wall-clock, we'd plumb a numeric path
        // through cityLocalToUtcIso.
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
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [50, 150, 300, 600]);
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
