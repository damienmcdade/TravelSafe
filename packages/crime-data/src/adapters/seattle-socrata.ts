import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { fetchSocrata } from "../lib/http.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";

// Seattle — SPD Crime Data.
// Socrata dataset tazs-3rd5 on data.seattle.gov. NIBRS-coded by SPD, which
// means we can read PERSONS / PROPERTY / SOCIETY directly off the row
// instead of inferring it from offense names.
// Doc: https://dev.socrata.com/foundry/data.seattle.gov/tazs-3rd5

const BASE = "https://data.seattle.gov/resource/tazs-3rd5.json";
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; }, "seattle-socrata");

interface SodaRow {
  offense_id?: string;
  offense_date?: string;
  report_date_time?: string;
  neighborhood?: string;
  precinct?: string;
  beat?: string;
  offense_category?: string;
  offense_sub_category?: string;
  nibrs_offense_code_description?: string;
  nibrs_crime_against_category?: string;  // PERSON | PROPERTY | SOCIETY | ANY
  latitude?: string;
  longitude?: string;
}

function mapToNibrs(row: SodaRow): CrimeCategory {
  // SPD publishes NIBRS classification directly — read it off the row instead
  // of inferring from the offense name.
  const c = (row.nibrs_crime_against_category ?? "").trim().toUpperCase();
  if (c === "PERSON") return CrimeCategory.PERSONS;
  if (c === "PROPERTY") return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "Seattle Police Department Crime Data (City of Seattle Open Data)",
  datasetUrl: "https://data.seattle.gov/Public-Safety/SPD-Crime-Data-2008-Present/tazs-3rd5",
  recency: "Refreshed daily by SPD; ~1-week reporting lag",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Seattle Police Department and aggregated " +
    "to SPD's neighborhood reporting areas — not live, not street-level. " +
    "CommunitySafe does not track individuals.",
};

// fix(audit coverage-seattle-titlecase-1): SPD prints ALL-CAPS neighborhood
// names with '/' separators and directional/acronym tokens. The old titleCase
// only capitalized after whitespace, so '/'-joined and acronym names rendered
// as 'Brighton/dunlap', 'Slu/cascade', 'Fauntleroy Sw'. Now split on whitespace
// AND '/', preserve the delimiters, and uppercase known acronyms.
//   SLU = South Lake Union; SW/NW/NE/SE = Seattle directional quadrants.
const SEATTLE_ACRONYMS = new Set(["SW", "NW", "NE", "SE", "SLU"]);
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s|\/)/) // keep the delimiters so '/' and spaces are preserved
    .map((tok) => {
      if (tok === "" || tok === " " || tok === "/") return tok;
      const up = tok.toUpperCase();
      if (SEATTLE_ACRONYMS.has(up)) return up;
      return tok[0].toUpperCase() + tok.slice(1);
    })
    .join("");
}

async function fetchSeattle(): Promise<Incident[]> {
  // v96 — migrated to fetchSocrata helper.
  // v96p2 — 180-day recent window. The unbounded "give me 50k
  // most-recent rows" pull was consistently hitting Socrata's slow
  // path (169 timeouts observed in production logs); every user
  // surface only needs the recent window (mix → 30d, citywide →
  // 90d, year-long fallback → 365d).
  const rows = await fetchSocrata<SodaRow>("Seattle SODA", {
    url: BASE,
    select: "offense_id,offense_date,neighborhood,precinct,beat,offense_category,nibrs_offense_code_description,nibrs_crime_against_category,latitude,longitude",
    windowDays: 180,
    dateField: "offense_date",
    order: "offense_date DESC",
    limit: 50000,
  });
  return rows.map((r, i) => {
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    // v104 — SPD uses (-1,-1) as a missing-geocode sentinel and occasionally
    // emits other out-of-range junk. The old `!== 0` guard let -1,-1 through,
    // which dragged neighborhood centroids ~80mi east — the all-cities audit
    // flagged Seattle as the only off-map city. Keep a point ONLY when both
    // coords land inside the Seattle bounding box; otherwise the incident still
    // counts but carries no map point.
    const geocoded = Number.isFinite(lat) && Number.isFinite(lon)
      && lat > 47.3 && lat < 47.85 && lon > -122.6 && lon < -122.2;
    // SPD prints neighborhood in ALL CAPS ("BITTERLAKE", "HIGHLAND PARK"). We
    // title-case it on intake so it reads naturally everywhere and matches
    // the polygon file's casing.
    const rawNbhd = r.neighborhood?.trim();
    const area = rawNbhd && rawNbhd !== "UNKNOWN" ? titleCase(rawNbhd) : "Unknown";
    return {
      id: `sea-${r.offense_id ?? i}`,
      area,
      // v96p2 — Seattle offense_date is wall-clock PT local time.
      occurredAt: cityLocalToUtcIso(r.offense_date, "America/Los_Angeles"),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.nibrs_offense_code_description?.trim() || r.offense_category?.trim() || "Unknown",
      beat: r.beat ?? null,
      blockLabel: undefined,
      lat: geocoded ? lat : undefined,
      lng: geocoded ? lon : undefined,
    };
  });
}

export async function getRowsSeattle(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchSeattle();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[seattle] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasSeattle(): Promise<KnownArea[]> {
  const rows = await getRowsSeattle();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    // SPD publishes some rows with neighborhood = literal "-" which
    // titlecases to "-" and produces a bogus `sea-` slug. Drop any
    // label that has no alphanumerics so the wheel never surfaces it.
    if (!/[a-z0-9]/i.test(r.area)) continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat; e.lngSum += r.lng; e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 3)
    .map(([name, e]) => {
      const slugSuffix = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      return {
        slug: `sea-${slugSuffix}`,
        label: name,
        jurisdiction: "Seattle",
        centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
      };
    })
    // Belt-and-braces: drop any entry whose slug somehow normalized to
    // just "sea-" (empty suffix). The alphanumeric filter above should
    // catch every case but this is the defensive backstop.
    .filter((a) => a.slug !== "sea-" && a.slug.length > 4)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForSeattleSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("sea-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  for (const r of rows) {
    if (r.area.toLowerCase() === s) return r.area;
  }
  return null;
}

export const seattleAdapter: CrimeDataAdapter = {
  name: "seattle-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsSeattle();
    const label = labelForSeattleSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [200, 600, 1200, 2000]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsSeattle();
    const label = labelForSeattleSlug(area, rows);
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
