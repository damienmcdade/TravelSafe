import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { fetchSocrata } from "../lib/http.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";

// Buffalo NY — Buffalo Police Crime Incidents on data.buffalony.gov
// (Socrata dataset d6g9-xbgu).
//
// Buffalo publishes a clean `parent_incident_type` field with 7 categories
// (Theft, Assault, Theft of Vehicle, Breaking & Entering, Robbery, Sexual
// Offense, Homicide) and a `neighborhood` field naming one of 35 official
// Buffalo neighborhoods (Allentown, North Park, Central, Broadway Fillmore,
// West Side, Elmwood Bryant, Lower/Upper West Side, etc.).
//
// Per-row lat/lng on every record. No demographic columns. Per-row block
// addresses, not exact addresses.

const BASE = "https://data.buffalony.gov/resource/d6g9-xbgu.json";
const ROW_LIMIT = 5_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; }, "buffalo-socrata");

interface BufRow {
  case_number?: string;
  incident_datetime?: string;
  incident_type_primary?: string;
  parent_incident_type?: string;
  hour_of_day?: string;
  day_of_week?: string;
  address_1?: string;
  city?: string;
  zip_code?: string;
  neighborhood?: string;
  council_district?: string;
  police_district?: string;
  census_tract?: string;
  latitude?: string;
  longitude?: string;
}

function mapToNibrs(row: BufRow): CrimeCategory {
  const p = (row.parent_incident_type ?? "").toUpperCase().trim();
  if (p === "ASSAULT" || p === "SEXUAL OFFENSE" || p === "HOMICIDE") return CrimeCategory.PERSONS;
  if (p === "THEFT" || p === "THEFT OF VEHICLE" || p === "BREAKING & ENTERING" || p === "ROBBERY") return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "Buffalo Police Crime Incidents (Open Data Buffalo, Socrata)",
  datasetUrl: "https://data.buffalony.gov/Public-Safety/Crime-Incidents/d6g9-xbgu",
  recency: "Refreshed near-daily by BPD",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Buffalo Police Department and aggregated " +
    "to one of 35 official Buffalo neighborhoods. BPD's `parent_incident_type` " +
    "field is honored directly (Theft / Assault / Vehicle Theft / Breaking & " +
    "Entering / Robbery / Sexual Offense / Homicide). Block-level addresses " +
    "only; per-incident locations are coarsened by BPD before publication.",
};

// v99 — route the naive-local upstream timestamp through
// cityLocalToUtcIso so the hour-of-day histogram buckets by the
// city's real local clock instead of the UTC runtime (was shifting
// every incident by the source-city offset). See lib/city-time.ts.
function safeIso(raw: string | null | undefined): string {
  return cityLocalToUtcIso(raw, "America/New_York");
}

async function fetchBuffalo(): Promise<Incident[]> {
  // v96 — migrated to fetchSocrata helper.
  // v96p2 — defensive 180-day recent window matching the other adapters.
  const rows = await fetchSocrata<BufRow>("Buffalo Socrata", {
    url: BASE,
    select: "case_number,incident_datetime,incident_type_primary,parent_incident_type,address_1,city,zip_code,neighborhood,council_district,police_district,census_tract,latitude,longitude",
    where: "neighborhood IS NOT NULL AND latitude IS NOT NULL",
    windowDays: 180,
    dateField: "incident_datetime",
    order: "incident_datetime DESC",
    limit: ROW_LIMIT,
  });
  return rows.map((r, i) => {
    const lat = Number(r.latitude);
    const lng = Number(r.longitude);
    const area = r.neighborhood?.trim();
    return {
      id: `buf-${r.case_number ?? i}`,
      area: area && area !== "UNKNOWN" ? area : "Unknown",
      occurredAt: safeIso(r.incident_datetime),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: titleCaseOffense(r.incident_type_primary || r.parent_incident_type),
      beat: r.police_district ?? null,
      blockLabel: undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lng) && lng !== 0 ? lng : undefined,
    };
  });
}

export async function getRowsBuffalo(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchBuffalo();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[buf] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasBuffalo(): Promise<KnownArea[]> {
  const rows = await getRowsBuffalo();
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
      slug: `buf-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Buffalo",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForBuffaloSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("buf-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const buffaloAdapter: CrimeDataAdapter = {
  name: "buffalo-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsBuffalo();
    const label = labelForBuffaloSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [40, 120, 250, 500]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsBuffalo();
    const label = labelForBuffaloSlug(area, rows);
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
