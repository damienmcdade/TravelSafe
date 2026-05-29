import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";

// Philadelphia — Crime Incidents Part 1 & Part 2 (PPD).
// CARTO SQL API at phl.carto.com — third adapter shape after Socrata and
// ArcGIS. CARTO accepts a custom SQL string in the URL `q=` parameter and
// returns rows in `result.rows`, ordered as the SQL specifies.
// Doc: https://www.opendataphilly.org/dataset/crime-incidents

const BASE = "https://phl.carto.com/api/v2/sql";
const TABLE = "incidents_part1_part2";
// Philly publishes ~415 Part-1 + Part-2 incidents per day. The
// original 5k limit spanned ~12 days of cached activity;
// safety-score's 365-day annualization gave a ~30× multiplier that
// made every refresh swing the citywide rate by tens of percent.
// 30k rows covers ~75 days — past the 30-day "low confidence"
// trip-wire and stable across cache cycles. CARTO SQL accepts
// larger LIMITs but 30k is comfortable; raising further has
// diminishing returns vs the request payload size.
const ROW_LIMIT = 30_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface PhlRow {
  objectid?: number;
  dc_dist?: string | null;        // "09", "19", "25" (zero-padded)
  text_general_code?: string | null;
  dispatch_date_time?: string | null;
  point_x?: number | null;        // longitude (CARTO uses x = lng)
  point_y?: number | null;        // latitude
  location_block?: string | null;
  psa?: string | null;
}

const PERSONS_KEYWORDS = [
  "ASSAULT", "ROBBERY", "HOMICIDE", "MURDER", "RAPE", "SEX",
  "HARASSMENT", "STALKING", "KIDNAP", "THREATS",
];
const PROPERTY_KEYWORDS = [
  "THEFT", "BURGLARY", "ARSON", "VANDALISM", "FRAUD",
  "FORGERY", "TRESPASS", "RECEIVING STOLEN", "STOLEN",
];
function mapToNibrs(row: PhlRow): CrimeCategory {
  const t = (row.text_general_code ?? "").toUpperCase();
  if (PERSONS_KEYWORDS.some((k) => t.includes(k))) return CrimeCategory.PERSONS;
  if (PROPERTY_KEYWORDS.some((k) => t.includes(k))) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// PPD's 21 police districts mapped to the single most-recognized
// neighborhood name in each district's service area. The prior map
// surfaced the district number AND a comma-list of neighborhoods
// ("9th District: Center City"); users want the real neighborhood
// name only ("Center City"). Where two districts cover similar
// geography, we differentiate by picking distinct anchor
// neighborhoods (5 vs 7 vs 8 vs 15 — all "Northeast" — get
// Frankford / Bustleton / Somerton / Tacony respectively).
const DISTRICT_NEIGHBORHOODS: Record<number, string> = {
  1:  "South Philadelphia",
  2:  "Mayfair",
  3:  "Pennsport",
  5:  "Frankford",
  7:  "Bustleton",
  8:  "Somerton",
  9:  "Center City",
  12: "Eastwick",
  14: "Germantown",
  15: "Tacony",
  16: "Mantua",
  17: "Point Breeze",
  18: "Cobbs Creek",
  19: "University City",
  22: "Brewerytown",
  24: "Kensington",
  25: "Hunting Park",
  26: "Fishtown",
  35: "Olney",
  39: "East Falls",
  77: "Citywide",
};

function enrich(dc_dist: string | null | undefined): string {
  if (!dc_dist) return "Unknown";
  const n = parseInt(dc_dist, 10);
  if (!Number.isFinite(n)) return "Unknown";
  // Drop the district-number prefix per v10 directive — surface
  // the real neighborhood name only. Fall back to "PPD District N"
  // for any number we haven't mapped yet so unknown districts
  // remain identifiable instead of all collapsing to "Unknown".
  return DISTRICT_NEIGHBORHOODS[n] ?? `PPD District ${n}`;
}

const PROVENANCE: DataProvenance = {
  source: "Philadelphia Crime Incidents Part 1 & Part 2 (OpenDataPhilly, CARTO SQL)",
  datasetUrl: "https://opendataphilly.org/datasets/crime-incidents/",
  recency: "Refreshed daily by the Philadelphia Police Department",
  granularity: "beat",
  disclaimer:
    "Incidents are reported by the Philadelphia Police Department and " +
    "aggregated to PPD's 21 districts — not live, not street-level. TravelSafe " +
    "does not track individuals.",
};

async function fetchPhl(): Promise<Incident[]> {
  const sql = `SELECT objectid,dc_dist,text_general_code,dispatch_date_time,point_x,point_y,location_block,psa FROM ${TABLE} WHERE dispatch_date_time IS NOT NULL ORDER BY dispatch_date_time DESC LIMIT ${ROW_LIMIT}`;
  // POST the SQL rather than encoding it into the URL. CARTO's openresty
  // gateway rejects GETs whose request line is too long with an HTML 400
  // — at LIMIT 30k the encoded query crosses that ceiling and every
  // build was logging "[phl] fetch failed: PHL CARTO 400". POST has no
  // such limit, and the API contract is the same either way.
  const formBody = new URLSearchParams({ q: sql }).toString();
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 TravelSafe/0.1 (https://github.com/damienmcdade/TravelSafe)",
    },
    body: formBody,
  });
  if (!res.ok) throw new Error(`PHL CARTO ${res.status}`);
  const body = await res.json() as { rows?: PhlRow[]; error?: unknown };
  if (body.error) throw new Error(`PHL CARTO error: ${JSON.stringify(body.error)}`);
  const rows = body.rows ?? [];
  return rows.map((r, i) => {
    // CARTO returns point_x = lng, point_y = lat (the GIS XY convention).
    const lng = typeof r.point_x === "number" ? r.point_x : undefined;
    const lat = typeof r.point_y === "number" ? r.point_y : undefined;
    return {
      id: `phl-${r.objectid ?? i}`,
      area: enrich(r.dc_dist),
      occurredAt: r.dispatch_date_time ?? new Date(0).toISOString(),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.text_general_code?.trim() || "Unknown",
      beat: r.psa ?? null,
      blockLabel: r.location_block ?? undefined,
      lat: typeof lat === "number" && lat !== 0 ? lat : undefined,
      lng: typeof lng === "number" && lng !== 0 ? lng : undefined,
    };
  });
}

export async function getRowsPhl(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchPhl();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[phl] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasPhl(): Promise<KnownArea[]> {
  const rows = await getRowsPhl();
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
    .map(([name, e]) => {
      // Extract the leading number ("9th District: ..." → "9") for a clean slug.
      const m = name.match(/^(\d+)/);
      const num = m ? m[1] : name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      return {
        slug: `phl-${num}`,
        label: name,
        jurisdiction: "Philadelphia",
        centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
      };
    })
    .sort((a, b) => {
      const na = parseInt(a.label, 10) || 999;
      const nb = parseInt(b.label, 10) || 999;
      return na - nb;
    });
}

function labelForPhlSlug(slug: string, rows: Incident[]): string | null {
  // v10 mapped PPD district numbers to neighborhood names ("Center City",
  // "Mayfair", etc.) and discovery now produces string slugs ("phl-
  // center-city") rather than numeric ones ("phl-9"). The prior matcher
  // here still expected a numeric tail and returned null for every
  // string slug, which made getAreaStats return null for every
  // neighborhood and the citywide endpoint show 0 incidents per area
  // despite 30k cached rows. Match by normalized-label string instead
  // (same pattern as the Pittsburgh/Buffalo/Norfolk adapters).
  const s = slug.toLowerCase();
  const want = s.startsWith("phl-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const phlAdapter: CrimeDataAdapter = {
  name: "phl-carto",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsPhl();
    const label = labelForPhlSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [60, 180, 350, 600]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsPhl();
    const label = labelForPhlSlug(area, rows);
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
