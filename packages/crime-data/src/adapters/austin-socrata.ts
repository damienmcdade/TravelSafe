import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";
import { registerRowCache } from "../cache-registry.js";
import { bucketByBands, deriveBands } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { fetchSocrata } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";

// Austin TX — APD Crime Reports on data.austintexas.gov
// (Socrata dataset fdj4-gpfu, ~2.6M rows, refreshed routinely).
//
// Shape notes (verified 2026-05-31 against the live feed):
//  - There is NO per-row lat/lng on this dataset (re-verified 2026-06-01:
//    the only geographic columns are `census_block_group`, `sector`,
//    `district`, `council_district` — Austin strips coordinates, so TRUE
//    per-incident neighborhood assignment is impossible). We bucket by APD
//    SECTOR — the cleanest ≈neighborhood grain Austin exposes.
//  - APD names its 10 sectors only by NATO-phonetic call signs (Adam,
//    Baker, …) with NO published descriptive/region name. Those codes are
//    unrecognizable to users, so we RELABEL each sector with a geographic
//    description ("North", "Central / Downtown", "Southeast", …) DERIVED
//    from the actual position of that sector's polygon centroid relative
//    to the Austin city center (30.2672, -97.7431). The original phonetic
//    is preserved in a "(Sector X)" suffix for cross-reference with APD.
//    The friendly label is emitted as the area label AND written verbatim
//    as the properties.name of apps/web/public/geo/austin.geojson so the
//    Crime Map's normName() polygon→area join stays 1:1.
//  - The occurrence timestamp is split across `occ_date` (ISO date at
//    local-midnight, e.g. "2026-05-23T00:00:00.000") and `occ_time`
//    (an HHMM string, e.g. "2055"). We recombine them into an Austin
//    wall-clock string and convert to UTC via cityLocalToUtcIso so the
//    time-of-day histogram buckets on the city's real local clock.
//    (Austin is NOT date-only — occ_time carries the real hour.)
//  - Offense classification prefers the published `ucr_category` NIBRS
//    code (11A/13A/120/23H/…) when present, else the `category_description`
//    / `crime_type` free-text. NIBRS report-based feed → no CFS scaling.

const BASE = "https://data.austintexas.gov/resource/fdj4-gpfu.json";
// Austin is huge (~2.6M rows lifetime; APD logs ~300-400 incidents/day).
// Cap each pull at Socrata's 50k hard ceiling over a rolling window. At
// 50k rows the 365-day window is the binding constraint, not the row cap,
// for any single sector — but we keep the cap so a pathological response
// can't blow the function memory budget, mirroring the big-Socrata
// adapters (Chicago/NYC/KC).
const ROW_LIMIT = 50_000;
const WINDOW_DAYS = 365;
const CACHE_TTL_MS = 5 * 60 * 1000;

// Paired O(1) indexes (slug→label, label→rows) built once per cache load.
// Same pattern as Norfolk / KC — Austin has only ~10 sectors so the win is
// small, but it keeps getIncidents/getAreaStats a Map lookup instead of a
// full-row scan per call.
interface Cache {
  fetchedAt: number;
  rows: Incident[];
  slugToLabel: Map<string, string>;
  labelToRows: Map<string, Incident[]>;
}
let cache: Cache | null = null;
registerRowCache(() => { cache = null; }, "austin-socrata");
function buildAustinIndexes(rows: Incident[]): Pick<Cache, "slugToLabel" | "labelToRows"> {
  const slugToLabel = new Map<string, string>();
  const labelToRows = new Map<string, Incident[]>();
  for (const r of rows) {
    const label = r.area;
    if (!label) continue;
    let bucket = labelToRows.get(label);
    if (!bucket) { bucket = []; labelToRows.set(label, bucket); }
    bucket.push(r);
    if (!slugToLabel.has(label)) {
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      slugToLabel.set(slug, label);
    }
  }
  return { slugToLabel, labelToRows };
}

interface AustinRow {
  incident_report_number?: string;
  crime_type?: string;
  ucr_code?: string;
  ucr_category?: string;
  category_description?: string;
  occ_date?: string;
  occ_time?: string;
  sector?: string;
  district?: string;
  council_district?: string;
  location_type?: string;
}

// APD 2-letter sector code → user-recognizable geographic label.
//
// The region descriptor is DERIVED from the sector polygon's centroid
// position vs the Austin city center (30.2672, -97.7431), computed from
// apps/web/public/geo/austin.geojson (see SECTOR_CENTROIDS below):
//   Adam    (30.422,-97.786) far N, slightly W   → "North"
//   Baker   (30.331,-97.773) N of center          → "North Central"
//   Edward  (30.382,-97.672) far N + E            → "Northeast"
//   Ida     (30.328,-97.704) N + E (inside Edward) → "Northeast Central"
//   Charlie (30.299,-97.643) E of center          → "East"
//   George  (30.272,-97.749) dead center          → "Central / Downtown"
//   David   (30.226,-97.836) SW of center         → "Southwest"
//   Frank   (30.174,-97.783) far S, slightly W    → "South"
//   Henry   (30.204,-97.674) SE of center         → "Southeast"
//   Apt     (30.194,-97.666) SE, at ABIA airport  → "Airport / Southeast"
// The phonetic call sign is kept in the "(Sector X)" suffix so the label
// still cross-references APD's own dispatch geography. These are the only
// codes that map to a published polygon; every other feed value ("88",
// "UT", "CHAR", "BAKR", "GRGE", blank, …) is a typo / non-APD area /
// coarse placeholder and folds into "Unmapped".
const SECTOR_NAMES: Record<string, string> = {
  AD: "North (Sector Adam)",
  BA: "North Central (Sector Baker)",
  CH: "East (Sector Charlie)",
  DA: "Southwest (Sector David)",
  ED: "Northeast (Sector Edward)",
  FR: "South (Sector Frank)",
  GE: "Central / Downtown (Sector George)",
  HE: "Southeast (Sector Henry)",
  ID: "Northeast Central (Sector Ida)",
  AP: "Airport / Southeast (Sector Apt)",
};

function sectorToArea(code: string | undefined): string {
  const c = (code ?? "").trim().toUpperCase();
  return SECTOR_NAMES[c] ?? "Unmapped";
}

// Offense → NIBRS top-level bucket. Austin publishes the NIBRS offense
// code in `ucr_category` (e.g. 11A Rape, 13A Aggravated Assault, 120
// Robbery, 220 Burglary, 23x Larceny, 35A Drugs). When present we route
// off the code (authoritative); otherwise fall back to keyword matching
// the free-text crime_type / category_description.
//
// ROBBERY (120) is FBI UCR Part-1 VIOLENT — counted as PERSONS, the same
// reclassification the Dallas / KC / Saint-Paul adapters make so the
// citywide violent rate isn't missing robbery.
const PERSONS_KEYS = [
  "ASSAULT", "AGG ASSAULT", "MURDER", "HOMICIDE", "MANSLAUGHTER",
  "KIDNAP", "ABDUCT", "RAPE", "SEXUAL", "SEX ASSAULT", "FONDLING",
  "ROBBERY", "CARJACK", "FAMILY DISTURBANCE", "FAMILY VIOLENCE",
  "STALK", "HARASSMENT", "THREAT", "INTIMIDAT", "STAB", "SHOOT",
];
const PROPERTY_KEYS = [
  "BURGLARY", "THEFT", "LARCENY", "STOLEN", "STEAL", "SHOPLIFT",
  "AUTO THEFT", "BURG OF VEHICLE", "BURGLARY OF VEHICLE", "ARSON",
  "CRIMINAL MISCHIEF", "VANDAL", "DAMAGE", "GRAFFITI", "FRAUD",
  "FORGERY", "COUNTERFEIT", "EMBEZZLE", "BURG NON RESIDENCE",
];
const SOCIETY_KEYS = [
  "DRUG", "NARCOTIC", "POSSESSION", "WEAPON", "FIREARM",
  "DWI", "DUI", "INTOX", "PUBLIC INTOX", "DISORDERLY",
  "PROSTITUT", "TRESPASS", "WARRANT", "VIOLATION", "LIQUOR",
  "GAMBL", "OBSCEN",
];

function classify(row: AustinRow): CrimeCategory {
  const code = (row.ucr_category ?? "").trim().toUpperCase();
  if (code) {
    // NIBRS code first character / group → category. 120 = robbery
    // (forced VIOLENT). 09x homicide, 11x sex, 13x assault → PERSONS.
    // 200/220/23x/240/250/270/280/290 → PROPERTY. 35x/36x/39x/40x/520/
    // 720/90x → SOCIETY.
    if (/^120/.test(code)) return CrimeCategory.PERSONS;
    if (/^(09|10|11|13|36|64)/.test(code)) return CrimeCategory.PERSONS;
    if (/^(200|210|220|23|240|250|270|280|290|510)/.test(code)) return CrimeCategory.PROPERTY;
    // fall through to keyword for anything not matched by code prefix.
  }
  const t = `${row.category_description ?? ""} ${row.crime_type ?? ""}`.toUpperCase();
  if (PERSONS_KEYS.some((k) => t.includes(k))) return CrimeCategory.PERSONS;
  if (PROPERTY_KEYS.some((k) => t.includes(k))) return CrimeCategory.PROPERTY;
  if (SOCIETY_KEYS.some((k) => t.includes(k))) return CrimeCategory.SOCIETY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "Austin Police Crime Reports (City of Austin Open Data, Socrata)",
  datasetUrl: "https://data.austintexas.gov/Public-Safety/Crime-Reports/fdj4-gpfu",
  recency: "Refreshed routinely by APD; rolling ~365-day window",
  // fix(audit cov-austin-sectors-2): areas are APD's 10 patrol SECTORS (the
  // finest grain Austin's feed exposes), not neighborhoods — label as "beat".
  // Sector labels already carry a "(Sector X)" suffix for transparency.
  granularity: "beat",
  disclaimer:
    "Incidents are reported by the Austin Police Department and aggregated to " +
    "one of APD's named patrol sectors (Adam, Baker, Charlie…), the finest " +
    "geographic grain Austin publishes — this dataset has no per-incident " +
    "lat/lng. CommunitySafe does not request any demographic columns.",
};

// Per-sector centroid (area-weighted, from the dissolved austin.geojson
// sector polygons). Used as the per-area centroid in discovery — the
// dataset carries no lat/lng, so this is the honest sector center rather
// than a single citywide placeholder.
const SECTOR_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  "North (Sector Adam)": { lat: 30.4221, lng: -97.7864 },
  "North Central (Sector Baker)": { lat: 30.3311, lng: -97.7729 },
  "East (Sector Charlie)": { lat: 30.2993, lng: -97.6432 },
  "Southwest (Sector David)": { lat: 30.2260, lng: -97.8364 },
  "Northeast (Sector Edward)": { lat: 30.3819, lng: -97.6722 },
  "South (Sector Frank)": { lat: 30.1740, lng: -97.7828 },
  "Central / Downtown (Sector George)": { lat: 30.2723, lng: -97.7491 },
  "Southeast (Sector Henry)": { lat: 30.2042, lng: -97.6742 },
  "Northeast Central (Sector Ida)": { lat: 30.3284, lng: -97.7038 },
  "Airport / Southeast (Sector Apt)": { lat: 30.1937, lng: -97.6663 },
};
const AUSTIN_CENTROID = { lat: 30.2672, lng: -97.7431 };

// Recombine occ_date (ISO date at local-midnight) + occ_time (HHMM string)
// into an Austin wall-clock "YYYY-MM-DDTHH:MM:SS", then convert to UTC via
// cityLocalToUtcIso. Returns null when the date is missing/unparseable so
// the row is dropped (never silently epoch-0, which would collapse the
// safety-score rate window).
function combineOccurredAt(occDate: string | undefined, occTime: string | undefined): string | null {
  if (!occDate) return null;
  const datePart = occDate.slice(0, 10); // "2026-05-23T00:00:00.000" → "2026-05-23"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  // occ_time arrives as "2055", "930", "5", "0", or "". Left-pad to HHMM.
  const raw = (occTime ?? "").trim();
  let hh = "00", mm = "00";
  if (/^\d{1,4}$/.test(raw)) {
    const padded = raw.padStart(4, "0");
    const h = Number(padded.slice(0, 2));
    const m = Number(padded.slice(2, 4));
    if (h <= 23 && m <= 59) { hh = padded.slice(0, 2); mm = padded.slice(2, 4); }
  }
  const local = `${datePart}T${hh}:${mm}:00`;
  const iso = cityLocalToUtcIso(local, "America/Chicago");
  return +new Date(iso) <= 0 ? null : iso;
}

async function fetchAustin(): Promise<Incident[]> {
  const rows = await fetchSocrata<AustinRow>("Austin Socrata", {
    url: BASE,
    select:
      "incident_report_number,crime_type,ucr_code,ucr_category,category_description," +
      "occ_date,occ_time,sector,district,council_district,location_type",
    where: "occ_date IS NOT NULL",
    windowDays: WINDOW_DAYS,
    dateField: "occ_date",
    order: "occ_date DESC",
    limit: ROW_LIMIT,
  });
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const occurredAt = combineOccurredAt(r.occ_date, r.occ_time);
    if (!occurredAt) continue;
    const area = sectorToArea(r.sector);
    const rawOffense = r.category_description || r.crime_type;
    out.push({
      id: `atx-${r.incident_report_number ?? i}`,
      area,
      occurredAt,
      nibrsCategory: classify(r),
      ibrOffenseDescription: titleCaseOffense(rawOffense),
      beat: r.district ?? r.sector ?? null,
      blockLabel: undefined,
      // No per-row lat/lng on this dataset — supply the sector centroid so
      // discovery + the polygon-area peer-share fallback have a real point.
      lat: SECTOR_CENTROIDS[area]?.lat ?? AUSTIN_CENTROID.lat,
      lng: SECTOR_CENTROIDS[area]?.lng ?? AUSTIN_CENTROID.lng,
    });
  }
  return out;
}

// In-flight Promise dedup (see detroit-arcgis.ts / KC for the OOM rationale
// when the dispatcher fans out per-area).
let inFlightAustinFetch: Promise<Incident[]> | null = null;

export async function getRowsAustin(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightAustinFetch) return inFlightAustinFetch;
  inFlightAustinFetch = (async () => {
    try {
      const rows = await fetchAustin();
      if (rows.length > 0) cache = { fetchedAt: now, rows, ...buildAustinIndexes(rows) };
      return rows;
    } catch (err) {
      console.warn("[atx] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightAustinFetch = null;
    }
  })();
  return inFlightAustinFetch;
}

export async function getDiscoveredAreasAustin(): Promise<KnownArea[]> {
  const rows = await getRowsAustin();
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.area || r.area === "Unmapped") continue;
    counts.set(r.area, (counts.get(r.area) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, n]) => n >= 3)
    .map(([name]) => ({
      slug: `atx-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Austin",
      centroid: SECTOR_CENTROIDS[name] ?? AUSTIN_CENTROID,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// O(1) slug → label via the cache-time index.
function labelForAustinSlug(slug: string): string | null {
  if (!cache) return null;
  const s = slug.toLowerCase();
  const want = s.startsWith("atx-") ? s.slice(4) : s;
  return cache.slugToLabel.get(want) ?? null;
}

export const austinAdapter: CrimeDataAdapter = {
  name: "austin-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    await getRowsAustin();
    const label = labelForAustinSlug(area);
    if (!label) return null;
    const inArea = cache?.labelToRows.get(label) ?? [];
    if (inArea.length === 0) return null;
    // Self-calibrating quintile bands over Austin's own per-sector
    // distribution; degrades to hand-tuned thresholds. Austin sectors are
    // large (≈neighborhood-cluster grain) so the fallback bands are high.
    const dist = [...(cache?.labelToRows.values() ?? [])].map((g) => g.length).filter((n) => n >= 3);
    const riskLevel = bucketByBands(inArea.length, deriveBands(dist, [400, 1200, 2400, 4000]));
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    await getRowsAustin();
    const label = labelForAustinSlug(area);
    if (!label) return [];
    let filtered = cache?.labelToRows.get(label) ?? [];
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    const sorted = [...filtered].sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return sorted.slice(0, opts?.limit ?? 50);
  },

  async getRecentReports(area: string, opts?: { limit?: number }) {
    return this.getIncidents(area, { limit: opts?.limit ?? 20 });
  },
};
