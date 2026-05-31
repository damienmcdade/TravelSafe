import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";
import { registerRowCache } from "../cache-registry.js";
import { bucketByBands, deriveBands } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { fetchSocrata } from "../lib/http.js";
import { kansasCityPolygons } from "../data/kansas-city-neighborhoods.js";

// Kansas City MO — KCPD Crime Data, current + prior year.
// KCPD publishes one Socrata dataset per calendar year (data.kcmo.org).
// The adapter previously hit only the current-year dataset, so in
// early calendar months the cache held only a few weeks of data;
// safety-score's 365d wall-clock window picked up whatever stray
// older timestamps were in the cache to set dataEarliestMs, mis-
// computed windowDays as 364, and annualized over a misleading
// span — KC's citywide grade read as a false A with rates ~10×
// below the FBI national. Same fix-pattern as DC: merge current +
// prior year so the cache spans a real ~17-month rolling window.
//
// IMPORTANT: the upstream dataset carries demographic columns
// (`race`, `sex`) on per-row victim/suspect records. The adapter
// EXPLICITLY enumerates outFields so the demographic columns are
// never requested.
//
// KCPD's own `area` field has only 6 patrol divisions (CPD/EPD/MPD/
// SPD/NPD/SCP) which is too coarse for neighborhood-level guidance.
// We point-in-polygon each row through 145 named Kansas City
// neighborhoods (blackmad/neighborhoods).

// Year → Socrata dataset ID. KCPD ships these as separate datasets;
// the catalog confirms 2018-2026 each has its own ID. When 2027
// lands we add it here. Datasets currently live, oldest → newest
// (only the most recent two are pulled at runtime).
const YEAR_DATASETS: Record<number, string> = {
  2026: "f7wj-ckmw",
  2025: "dmnp-9ajg",
  2024: "isbe-v4d8",
};
// 50k per year × 2 years = 100k rows. KCPD publishes ~50-150
// incidents/day (deduped to one row per report); at the previous
// 5k limit each year-dataset spanned only 30-100 days. Combined
// 2-year cache covers ~12-18 months of actual reporting volume
// — past the safety-score 30-day low-confidence trip-wire and
// stable across cache cycles. Socrata's $limit caps at 50k per
// request, so this is the per-year ceiling we can pull in one
// shot without paginating.
const ROW_LIMIT = 50_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
// v69 followup-3 — paired O(1) indexes (slug→label, label→rows)
// built once per cache load. Same speedup pattern as Detroit; see
// that adapter for the rationale.
interface Cache {
  fetchedAt: number;
  rows: Incident[];
  slugToLabel: Map<string, string>;
  labelToRows: Map<string, Incident[]>;
}
let cache: Cache | null = null;
registerRowCache(() => { cache = null; });
function buildKCIndexes(rows: Incident[]): Pick<Cache, "slugToLabel" | "labelToRows"> {
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

interface KcRow {
  report?: string;
  report_date?: string;
  from_date?: string;
  offense?: string;
  ibrs?: string;
  beat?: string;
  address?: string;
  city?: string;
  zipcode?: string;
  rep_dist?: string;
  area?: string;
  involvement?: string;
  dvflag?: boolean;
  location?: { type: "Point"; coordinates: [number, number] };
}

const PERSONS_KEYS = [
  "ASSAULT", "BATTERY", "HOMICIDE", "MURDER", "KIDNAP", "ABDUCT",
  "RAPE", "SEX OFFENSE", "SEX CRIME", "MOLEST", "ABUSE",
  "DOMESTIC", "HARASSMENT", "INTIMIDATION", "THREAT",
  // ROBBERY is FBI UCR Part-1 VIOLENT (force-from-theft to a person).
  // KC's feed has no explicit NIBRS bucket, and "ROBBERY" was being
  // swept into PROPERTY below, so KC's violent rate was missing all
  // robbery (~under-count) while property was inflated. Same fix as the
  // Dallas / Pittsburgh / Saint-Paul robbery reclassification. Checked
  // before PROPERTY_KEYS so it wins.
  "ROBBERY",
];
const PROPERTY_KEYS = [
  "STEALING", "STOLEN", "BURGLARY", "THEFT", "LARCENY",
  "PROPERTY DAMAGE", "VANDAL", "ARSON", "FORGERY", "FRAUD",
  "EMBEZZLE", "VEHICULAR",
];
const SOCIETY_KEYS = [
  "DRUG", "NARCOTIC", "POSSESSION", "WEAPON", "FIREARM",
  "TRESPASS", "DISORDERLY", "DUI", "INTOX", "PROSTITUTION",
  "WARRANT", "VIOLATION",
];
// Drop ambiguous/administrative entries at ingest.
const SKIP_KEYS = [
  "MISCELLANEOUS INVESTIGATION", "DEAD BODY", "FOUND -", "LOST -",
  "RECOVER", "INFORMATION REPORT",
];

function classify(desc: string): CrimeCategory | null {
  const t = desc.toUpperCase();
  for (const k of SKIP_KEYS) if (t.includes(k)) return null;
  if (PERSONS_KEYS.some((k) => t.includes(k))) return CrimeCategory.PERSONS;
  if (PROPERTY_KEYS.some((k) => t.includes(k))) return CrimeCategory.PROPERTY;
  if (SOCIETY_KEYS.some((k) => t.includes(k))) return CrimeCategory.SOCIETY;
  return null;
}

// ---- Point-in-polygon ------------------------------------------------------

interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = kansasCityPolygons.map((p) => {
  const rings: number[][][] = p.geometry.type === "Polygon"
    ? (p.geometry.coordinates as number[][][])
    : (p.geometry.coordinates as number[][][][]).flat();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { name: p.name, bbox: [minX, minY, maxX, maxY], rings };
});

function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// KCPD patrol-division codes → readable area labels. Used as the fallback
// for incidents whose coordinates fall outside all 145 neighborhood polygons
// (~28% — mostly the outer/Northland city), so they still count citywide.
const KC_DIVISIONS: Record<string, string> = {
  CPD: "Central Patrol Division",
  EPD: "East Patrol Division",
  MPD: "Metro Patrol Division",
  SPD: "South Patrol Division",
  NPD: "North Patrol Division",
  SCP: "Shoal Creek Patrol Division",
  OSPD: "Special Operations Division",
};
function divisionLabel(code: string | undefined): string {
  const c = (code ?? "").trim().toUpperCase();
  return KC_DIVISIONS[c] ?? "Unknown";
}

function geocodeKansasCity(lng: number, lat: number): string | null {
  for (const p of POLY_INDEX) {
    const [minX, minY, maxX, maxY] = p.bbox;
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
    let parity = 0;
    for (const ring of p.rings) if (pointInRing(lng, lat, ring)) parity++;
    if (parity % 2 === 1) return p.name;
  }
  return null;
}

const PROVENANCE: DataProvenance = {
  source: "Kansas City MO Police Crime Data — current + prior year (Open Data KC, Socrata)",
  datasetUrl: "https://data.kcmo.org/browse?q=KCPD+Crime+Data",
  recency: "Refreshed routinely by KCPD; merged across calendar-year datasets for a rolling ~17-month window",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Kansas City MO Police Department. " +
    "CommunitySafe explicitly excludes the victim/suspect demographic columns " +
    "(race, sex) published by KCPD from every request — they never reach our " +
    "server. Geocoded through 145 named Kansas City neighborhoods (blackmad/" +
    "neighborhoods) since KCPD's `area` field has only 6 patrol divisions.",
};

/// Parse a date string, returning null when invalid. The earlier
/// epoch-fallback variant silently included bad-date rows in the cache,
/// which the citywide aggregator then filtered out via `t > 0` —
/// collapsing the rate-compute window to 0 days and rendering Kansas
/// City's citywide score as ~0.00× national misleadingly.
// v99 — route the naive-local upstream timestamp through
// cityLocalToUtcIso so the hour-of-day histogram buckets by the
// city's real local clock instead of the UTC runtime. Preserve the
// original drop-the-row contract for unparseable input (the helper
// returns the epoch-0 ISO, which we map back to null).
function safeIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const iso = cityLocalToUtcIso(raw, "America/Chicago");
  return +new Date(iso) <= 0 ? null : iso;
}

async function fetchKansasCityYear(datasetId: string): Promise<KcRow[]> {
  // v96 — migrated to fetchSocrata helper.
  // v96p2 — 180-day recent window. Keeps the response under the
  // AbortSignal budget without scanning the per-year dataset's full
  // history.
  // EXPLICIT $select — never request the `race`/`sex` demographic columns.
  return fetchSocrata<KcRow>(`Kansas City Socrata ${datasetId}`, {
    url: `https://data.kcmo.org/resource/${datasetId}.json`,
    select: "report,report_date,from_date,offense,ibrs,beat,address,city,zipcode,rep_dist,area,involvement,location",
    where: "location IS NOT NULL",
    windowDays: 180,
    dateField: "report_date",
    order: "report_date DESC",
    limit: ROW_LIMIT,
  });
}

async function fetchKansasCity(): Promise<Incident[]> {
  // Pull current + prior year in parallel. The 5k row limit per year
  // gives us a typical 60-80 days of recent activity per year (KCPD
  // publishes ~50/day), so the merged set covers approximately the
  // most recent 4-6 months — narrow enough to be timely, wide enough
  // that safety-score's 365d window has stable dataEarliestMs.
  const currentYear = new Date().getUTCFullYear();
  const datasetIds: string[] = [];
  for (const yr of [currentYear, currentYear - 1]) {
    const ds = YEAR_DATASETS[yr];
    if (ds) datasetIds.push(ds);
  }
  const pages = await Promise.all(
    datasetIds.map((ds) => fetchKansasCityYear(ds).catch((e) => {
      console.warn(`[kc] year-dataset ${ds} failed:`, (e as Error).message);
      return [] as KcRow[];
    })),
  );
  const rows = pages.flat();
  // KCPD's feed is PERSON-LEVEL — one row per involved party (victim / suspect /
  // arrestee / witness) per offense per report (see the `involvement` column:
  // VIC, SUS, ARR..., CMP VIC, VIC WIT, ...). The FBI counts UCR offenses
  // differently by type, so we mirror that to avoid the ~0.4× violent
  // under-count the old report-level dedup produced:
  //   - PERSONS (crimes against persons): counted PER VICTIM. KCMO's FBI
  //     violent total is ~77% aggravated assault; the feed carries ~4.7k
  //     victim-level aggravated-assault rows/yr (≈ the FBI 6,092 figure once
  //     all VIC-variants are included), but report-level dedup collapsed every
  //     multi-victim assault to one. Keep each victim row; drop suspect-only
  //     rows so offenders aren't counted as incidents.
  //   - PROPERTY / SOCIETY: counted PER INCIDENT (report + offense), the NIBRS
  //     convention — one burglary is one offense regardless of involved parties.
  const isVictimRow = (inv: string | undefined) => /\bVIC\b/i.test(inv ?? "");
  const seen = new Set<string>();
  const out: Incident[] = [];
  let victimSeq = 0;
  for (const r of rows) {
    const reportId = r.report ?? "";
    const desc = r.offense?.trim() ?? "";
    const cat = classify(desc);
    if (cat == null) continue;
    let id: string;
    if (cat === CrimeCategory.PERSONS) {
      // Per-victim: skip non-victim parties; each victim row is its own offense.
      if (!isVictimRow(r.involvement)) continue;
      id = reportId ? `${reportId}|${desc.toUpperCase()}|v${victimSeq++}` : "";
    } else {
      // Per-incident: collapse all parties of the same property/society offense.
      id = reportId ? `${reportId}|${desc.toUpperCase()}` : "";
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
    }
    const coords = r.location?.coordinates;
    const lng = coords ? Number(coords[0]) : NaN;
    const lat = coords ? Number(coords[1]) : NaN;
    let area = "Unknown";
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
      // The 145 blackmad neighborhood polygons cover only ~72% of KCMO's
      // 319 sq mi (the outer/Northland areas have no polygon). Points that
      // miss every polygon were being DROPPED as Unknown — silently
      // discarding ~28% of all incidents, which the citywide grader (it
      // sums only discovered areas) read as a ~0.72x under-count. Fall back
      // to the row's KCPD patrol division so the incident still counts.
      area = geocodeKansasCity(lng, lat) ?? divisionLabel(r.area);
    }
    if (area === "Unknown") continue;
    const occurredAt = safeIso(r.from_date ?? r.report_date);
    if (!occurredAt) continue; // drop rows with no valid date
    out.push({
      id: `kc-${id || out.length}`,
      area,
      occurredAt,
      nibrsCategory: cat,
      ibrOffenseDescription: desc,
      beat: r.beat ?? (r.area ? `${r.area} division` : null),
      blockLabel: undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lng) && lng !== 0 ? lng : undefined,
    });
  }
  return out;
}

// v94 — in-flight Promise dedup. See detroit-arcgis.ts for the OOM
// rationale (145 KC areas × Promise.all fan-out from the dispatcher
// would fire 145 concurrent fetches without this guard).
let inFlightKCFetch: Promise<Incident[]> | null = null;

export async function getRowsKansasCity(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightKCFetch) return inFlightKCFetch;
  inFlightKCFetch = (async () => {
    try {
      const rows = await fetchKansasCity();
      if (rows.length > 0) cache = { fetchedAt: now, rows, ...buildKCIndexes(rows) };
      return rows;
    } catch (err) {
      console.warn("[kc] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightKCFetch = null;
    }
  })();
  return inFlightKCFetch;
}

export async function getDiscoveredAreasKansasCity(): Promise<KnownArea[]> {
  const rows = await getRowsKansasCity();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat; e.lngSum += r.lng; e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 1)  // v89 — was 3; KCMO has ~240 registered neighborhoods
    .map(([name, e]) => ({
      slug: `kc-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Kansas City",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// v69 followup-3 — O(1) slug → label via the cache-time index.
function labelForKansasCitySlug(slug: string): string | null {
  if (!cache) return null;
  const s = slug.toLowerCase();
  const want = s.startsWith("kc-") ? s.slice(3) : s;
  return cache.slugToLabel.get(want) ?? null;
}

export const kansasCityAdapter: CrimeDataAdapter = {
  name: "kansas-city-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    await getRowsKansasCity();
    const label = labelForKansasCitySlug(area);
    if (!label) return null;
    const inArea = cache?.labelToRows.get(label) ?? [];
    if (inArea.length === 0) return null;
    // Self-calibrating quintile bands over this city's own per-area
    // distribution (the cached labelToRows map sizes, floored at 3 to
    // ignore stray geocodes); degrades to the prior hand-tuned thresholds.
    const dist = [...(cache?.labelToRows.values() ?? [])].map((g) => g.length).filter((n) => n >= 3);
    const riskLevel = bucketByBands(inArea.length, deriveBands(dist, [20, 70, 150, 300]));
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    await getRowsKansasCity();
    const label = labelForKansasCitySlug(area);
    if (!label) return [];
    let filtered = cache?.labelToRows.get(label) ?? [];
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered = [...filtered].sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },

  async getRecentReports(area: string, opts?: { limit?: number }) {
    return this.getIncidents(area, { limit: opts?.limit ?? 20 });
  },
};
