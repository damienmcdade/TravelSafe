import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { fetchSocrata } from "../lib/http.js";

// City of New York — NYPD Complaint Data Current (Year-To-Date).
// Socrata dataset 5uac-w243 on data.cityofnewyork.us. We use the YTD feed
// rather than the 2006-present historical feed (qgea-i56i) so users see
// fresh data; the historical feed is decades-large but updated yearly.
// Doc: https://dev.socrata.com/foundry/data.cityofnewyork.us/5uac-w243

const BASE = "https://data.cityofnewyork.us/resource/5uac-w243.json";
const CACHE_TTL_MS = 5 * 60 * 1000;
// v58 — pagination. Socrata's unauthenticated $limit ceiling is 50,000
// rows per request. NYC publishes ~500k complaints/year via this feed,
// so a single 50k page covers only ~30-40 days — driving the citywide
// safety-score windowDays into the "short" band and dropping the
// PERSONS/PROPERTY ratio vs FBI baseline (audit was 0.67 / 0.43).
// 4 pages × 50k = 200k rows ≈ 4-5 months of NYC volume, putting
// windowDays solidly above the 90-day comfort threshold.
const PAGE_SIZE = 50_000;
const PAGES_TO_FETCH = 4;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; });

interface SodaRow {
  cmplnt_num?: string;
  cmplnt_fr_dt?: string;     // ISO date, time portion always 00:00:00.000
  cmplnt_fr_tm?: string;     // HH:MM:SS — concatenate with cmplnt_fr_dt
  boro_nm?: string;          // MANHATTAN | BRONX | BROOKLYN | QUEENS | STATEN ISLAND
  addr_pct_cd?: string;      // precinct number, 1..123 (gaps)
  ofns_desc?: string;
  pd_desc?: string;
  law_cat_cd?: string;       // FELONY | MISDEMEANOR | VIOLATION
  latitude?: string;
  longitude?: string;
}

// NYPD doesn't tag complaints with a NIBRS category. We infer from the
// offense description; the substring matches below cover the bulk of the
// distinct ofns_desc values that appear in the dataset.
const PERSONS_KEYWORDS = [
  "ASSAULT", "ROBBERY", "MURDER", "HOMICIDE", "SEX", "RAPE",
  "KIDNAPPING", "HARRASSMENT", "STRANGULATION", "MENACING",
  "OFFENSES AGAINST THE PERSON",
];
const PROPERTY_KEYWORDS = [
  "LARCENY", "BURGLARY", "THEFT", "STOLEN", "ARSON",
  "VEHICLE", "FRAUD", "FORGERY", "CRIMINAL MISCHIEF",
  "TRESPASS", "PROPERTY",
];
function mapToNibrs(row: SodaRow): CrimeCategory {
  const desc = (row.ofns_desc ?? "").toUpperCase();
  if (PERSONS_KEYWORDS.some((k) => desc.includes(k))) return CrimeCategory.PERSONS;
  if (PROPERTY_KEYWORDS.some((k) => desc.includes(k))) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// v99 — NYPD severity-aware Part-1 descriptor. The feed carries law_cat_cd
// (FELONY | MISDEMEANOR | VIOLATION), the exact signal for aggravated-vs-simple.
// FBI UCR Part-1 aggravated assault = NYPD "FELONY ASSAULT" only; "ASSAULT 3 &
// RELATED OFFENSES" is MISDEMEANOR simple assault (NOT Part-1) and is the single
// largest NYC offense (~13.5k/window) — counting it inflated the violent rate to
// ~1.65× FBI. Emit a canonical descriptor so the shared Part-1 filter scores it
// right: felony assault → counted; misdemeanor/violation assault → "Simple
// Assault" (dropped by /\bsimple\b/). Misdemeanor sex crimes (not the separate
// "RAPE" offense) are likewise non-Part-1.
function nyOffenseDesc(row: SodaRow): string {
  const o = (row.ofns_desc ?? "").toUpperCase();
  const felony = (row.law_cat_cd ?? "").toUpperCase() === "FELONY";
  if (o.includes("ASSAULT")) return felony ? "Aggravated Assault" : "Simple Assault";
  if (o.includes("SEX CRIME") && !felony) return "Simple Sex Offense";
  return row.pd_desc?.trim() || row.ofns_desc?.trim() || "Unknown";
}

const PROVENANCE: DataProvenance = {
  source: "NYPD Complaint Data Current Year-To-Date (NYC Open Data)",
  datasetUrl: "https://data.cityofnewyork.us/Public-Safety/NYPD-Complaint-Data-Current-Year-To-Date-/5uac-w243",
  recency: "Refreshed weekly by NYPD; current calendar year only",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the New York City Police Department and " +
    "aggregated by NYPD precinct, then surfaced under each precinct's " +
    "primary-coverage neighborhood (per nyc.gov/site/nypd) — not live, " +
    "not street-level. CommunitySafe does not track individuals and " +
    "intentionally ignores victim-demographic columns published by NYPD.",
};

function ordinal(n: number): string {
  const j = n % 10, k = n % 100;
  if (k >= 10 && k <= 20) return `${n}th`;
  return `${n}${j === 1 ? "st" : j === 2 ? "nd" : j === 3 ? "rd" : "th"}`;
}

// NYPD precinct → recognizable-neighborhood label. NYPD publishes the
// canonical precinct boundaries and primary-coverage neighborhoods at
// nyc.gov/site/nypd/bureaus/patrol/precincts-landing.page. Every
// precinct number that ships in NYPD complaint data is keyed here;
// any unmapped number falls back to "<ordinal> Precinct" so the
// adapter never drops rows.
// Single anchor neighborhood per NYPD precinct. The prior map
// surfaced 1-3 slash-separated names + a borough suffix
// ("Tribeca / Financial District (Manhattan)"); v10 cleanup
// picks the single most-recognized neighborhood per precinct
// and drops the borough suffix (NYC neighborhood names are
// near-unique citywide; precincts that genuinely cover an
// ambiguous name get the more recognizable anchor).
const PRECINCT_TO_NEIGHBORHOOD: Record<number, string> = {
  // Manhattan
  1:  "Tribeca",
  5:  "Chinatown",
  6:  "West Village",
  7:  "Lower East Side",
  9:  "East Village",
  10: "Chelsea",
  13: "Gramercy",
  14: "Midtown South",
  17: "Murray Hill",
  18: "Midtown North",
  19: "Upper East Side",
  20: "Upper West Side",
  22: "Central Park",
  23: "East Harlem South",
  24: "Morningside Heights",
  25: "East Harlem North",
  26: "Hamilton Heights",
  28: "Central Harlem South",
  30: "West Harlem",
  32: "Central Harlem North",
  33: "Washington Heights South",
  34: "Inwood",
  // Bronx
  40: "Mott Haven",
  41: "Hunts Point",
  42: "Morrisania",
  43: "Soundview",
  44: "Highbridge",
  45: "Throgs Neck",
  46: "Fordham",
  47: "Wakefield",
  48: "Belmont",
  49: "Pelham Parkway",
  50: "Riverdale",
  52: "Bedford Park",
  // Brooklyn
  60: "Coney Island",
  61: "Sheepshead Bay",
  62: "Bensonhurst",
  63: "Marine Park",
  66: "Borough Park",
  67: "East Flatbush",
  68: "Bay Ridge",
  69: "Canarsie",
  70: "Midwood",
  71: "Crown Heights South",
  72: "Sunset Park",
  73: "Brownsville",
  75: "East New York",
  76: "Red Hook",
  77: "Crown Heights North",
  78: "Park Slope",
  79: "Bedford-Stuyvesant West",
  81: "Bedford-Stuyvesant East",
  83: "Bushwick",
  84: "Downtown Brooklyn",
  88: "Fort Greene",
  90: "Williamsburg South",
  94: "Greenpoint",
  // Queens
  100: "Rockaway",
  101: "Far Rockaway",
  102: "Richmond Hill",
  103: "Jamaica Center",
  104: "Ridgewood",
  105: "Queens Village",
  106: "Ozone Park",
  107: "Fresh Meadows",
  108: "Long Island City",
  109: "Flushing",
  110: "Elmhurst",
  111: "Bayside",
  112: "Forest Hills",
  113: "South Jamaica",
  114: "Astoria",
  115: "Jackson Heights",
  116: "Rosedale",
  // Staten Island
  120: "St. George",
  121: "Mariners Harbor",
  122: "South Beach",
  123: "Tottenville",
};

/// Translate a raw NYPD precinct number into the recognizable
/// neighborhood label users expect. Unmapped numbers fall back to
/// "<ordinal> Precinct" so the adapter still ingests them; PSA
/// (Police Service Area) housing-bureau codes and transit-bureau
/// codes that NYPD occasionally writes into addr_pct_cd will land
/// in that fallback bucket rather than being dropped.
function precinctName(p: string | undefined): string | null {
  if (!p) return null;
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0) return null;
  return PRECINCT_TO_NEIGHBORHOOD[n] ?? `${ordinal(n)} Precinct`;
}

async function fetchNypdPage(offset: number): Promise<SodaRow[]> {
  // v96 — migrated to fetchSocrata helper. Pagination support comes
  // via the offset param; the helper takes care of $select/$order/
  // $where encoding + 30 s timeout + X-App-Token via socrataHeaders.
  // v88 — bound to last 400 days so we don't pull ancient backfill
  // rows that safety-score immediately discards (rate window is
  // capped at 365 days). SoQL accepts ISO date literals here.
  const cutoff = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return fetchSocrata<SodaRow>(`NYPD SODA at offset ${offset}`, {
    url: BASE,
    select: "cmplnt_num,cmplnt_fr_dt,cmplnt_fr_tm,boro_nm,addr_pct_cd,ofns_desc,pd_desc,law_cat_cd,latitude,longitude",
    where: `cmplnt_fr_dt >= '${cutoff}'`,
    order: "cmplnt_fr_dt DESC",
    limit: PAGE_SIZE,
    offset,
  });
}

async function fetchNypd(): Promise<Incident[]> {
  // v89 → v93p6 — restored to bounded-concurrency=2. The serial
  // workaround was necessary because Socrata's anonymous-pool throttle
  // 500'd all 4 parallel pages simultaneously. With SOCRATA_APP_TOKEN
  // now configured (Tyler federation, applies to all 17 Socrata
  // adapters via the X-App-Token header in lib/http.ts), the per-app
  // rate-limit pool handles 2 concurrent NYPD pages fine. Cuts the
  // NYPD warm cycle from ~32s back to ~16s.
  // Kept bounded at 2 (not 4) — going higher tickles upstream
  // load-balancer rate-limits on the bigger NYPD dataset.
  const rows: SodaRow[] = [];
  const offsets = Array.from({ length: PAGES_TO_FETCH }, (_, i) => i * PAGE_SIZE);
  let cursor = 0;
  const concurrency = 2;
  const workers = Array.from({ length: Math.min(concurrency, offsets.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= offsets.length) return;
      const o = offsets[idx];
      try {
        const page = await fetchNypdPage(o);
        rows.push(...page);
      } catch (err) {
        console.warn(`[nypd] page offset=${o} failed:`, (err as Error).message);
      }
    }
  });
  await Promise.all(workers);
  // Drop rows with no parseable date BEFORE constructing Incidents. The
  // earlier `new Date(0).toISOString()` fallback survived row mapping
  // but was filtered out by the citywide aggregator's `t > 0` invariant,
  // collapsing windowDays → 0 → 0/100k → misleading "below national"
  // score. Same fix as Charlotte/DC/MPLS/KC/Cincinnati earlier.
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const datePart = (r.cmplnt_fr_dt ?? "").slice(0, 10); // YYYY-MM-DD
    if (!datePart) continue;
    const timePart = r.cmplnt_fr_tm ?? "00:00:00";
    const d = new Date(`${datePart}T${timePart}`);
    if (Number.isNaN(d.getTime()) || d.getTime() <= 0) continue;
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    const area = precinctName(r.addr_pct_cd) ?? "Unknown";
    out.push({
      id: `ny-${r.cmplnt_num ?? i}`,
      area,
      occurredAt: d.toISOString(),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: nyOffenseDesc(r),
      beat: null,
      blockLabel: undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lon) && lon !== 0 ? lon : undefined,
    });
  }
  return out;
}

export async function getRowsNYC(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchNypd();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[nypd] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasNYC(): Promise<KnownArea[]> {
  const rows = await getRowsNYC();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat; e.lngSum += r.lng; e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 3)
    .map(([name, e]) => ({
      // Slug derived from the full label (neighborhood + borough),
      // including the "(Brooklyn)" / "(Queens)" suffix so two
      // similarly-named neighborhoods across boroughs (e.g.,
      // Washington Heights vs the imaginary collision) stay
      // unambiguous. Round-trip works because labelForNYCSlug() does
      // the same slugify().
      slug: `ny-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "New York City",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    // Alpha sort by neighborhood name. The old precinct-number sort
    // no longer applies — labels are now neighborhood names, so
    // alphabetical is the natural reading order in the picker wheel.
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForNYCSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("ny-") ? s.slice(3) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const nypdAdapter: CrimeDataAdapter = {
  name: "nypd-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsNYC();
    const label = labelForNYCSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [200, 600, 1200, 2000]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsNYC();
    const label = labelForNYCSlug(area, rows);
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
