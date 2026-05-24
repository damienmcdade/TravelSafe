import "server-only";
import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";

// Colorado Springs PD — "Crime Level Data" on policedata.coloradosprings.gov.
// Socrata dataset bc88-hemr. Public, no auth required. Replaces Denver
// after Denver's ArcGIS feed went token-gated.
// Doc: https://policedata.coloradosprings.gov/Public-Safety/Crime-Level-Data/bc88-hemr
//
// Granularity: CSPD's 4 patrol divisions (Sand Creek, Gold Hill, Stetson
// Hills, Falcon). Coarser than the polygon-based geocoding other
// adapters use; CSPD doesn't publish a finer neighborhood polygon set
// publicly. Divisions are real names users recognize from CSPD
// communications, so we surface them directly rather than fabricating
// finer "neighborhood" labels.

const BASE = "https://policedata.coloradosprings.gov/resource/bc88-hemr.json";
const ROW_LIMIT = 5_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface CoSpRow {
  casenumber?: string;
  occurredfromdate?: string;
  reporteddate?: string;
  crimecodedescription?: string;
  crimecode?: string;
  statutedescription?: string;
  index_crime_category?: string;   // "Crimes Against Property" / "Crimes Against Persons" / "Crimes Against Society"
  streetaddress?: string;
  zip?: string;
  patrol_division?: string;        // "Falcon" / "Sand Creek" / "Stetson Hills" / "Gold Hill"
  location_point?: { type: "Point"; coordinates: [number, number] };
}

function mapToNibrs(row: CoSpRow): CrimeCategory {
  const v = (row.index_crime_category ?? "").trim().toLowerCase();
  if (v.includes("persons")) return CrimeCategory.PERSONS;
  if (v.includes("property")) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// CSPD patrol division centroids — approximate centers of each
// division's coverage area. Used so the neighborhood-discovery code
// has a stable point per division even if a particular fetch returns
// no rows for that area. Values eyeball-checked against CSPD's
// published patrol-division map.
const DIVISION_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  "Sand Creek":    { lat: 38.835, lng: -104.731 },
  "Gold Hill":     { lat: 38.835, lng: -104.825 },
  "Stetson Hills": { lat: 38.910, lng: -104.755 },
  "Falcon":        { lat: 38.970, lng: -104.640 },
};

const PROVENANCE: DataProvenance = {
  source: "Colorado Springs Police Department Crime Level Data (CSPD Open Data)",
  datasetUrl: "https://policedata.coloradosprings.gov/Public-Safety/Crime-Level-Data/bc88-hemr",
  recency: "Refreshed daily by CSPD; ~1-2 day reporting lag",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Colorado Springs Police Department and " +
    "aggregated to CSPD's 4 patrol divisions (Sand Creek, Gold Hill, Stetson " +
    "Hills, Falcon) — not live, not street-level. CommunitySafe does not track individuals.",
};

function safeIso(raw: string | null | undefined): string {
  if (!raw) return new Date(0).toISOString();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

async function fetchCoSp(): Promise<Incident[]> {
  // Pull the freshest slice. `occurredfromdate IS NOT NULL` guards
  // against partially-filed rows. CSPD also publishes a sparser
  // `reporteddate`; using occurred-date keeps timestamps aligned
  // with when the incident actually happened.
  const u = `${BASE}?$limit=${ROW_LIMIT}&$order=occurredfromdate%20DESC&$where=occurredfromdate%20IS%20NOT%20NULL`;
  const res = await fetch(u, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/CommunitySafe)" },
  });
  if (!res.ok) throw new Error(`CoSp Socrata ${res.status}`);
  const rows = (await res.json()) as CoSpRow[];
  return rows.map((r, i) => {
    const c = r.location_point?.coordinates;
    const lng = Array.isArray(c) ? Number(c[0]) : NaN;
    const lat = Array.isArray(c) ? Number(c[1]) : NaN;
    const area = r.patrol_division?.trim() || "Unknown";
    return {
      id: `cosp-${r.casenumber ?? i}`,
      area,
      occurredAt: safeIso(r.occurredfromdate),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.crimecodedescription?.trim() || r.statutedescription?.trim() || "Unknown",
      beat: r.patrol_division ?? null,
      blockLabel: r.streetaddress ?? undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lng) && lng !== 0 ? lng : undefined,
    };
  });
}

export async function getRowsCoSp(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchCoSp();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[colorado-springs] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasCoSp(): Promise<KnownArea[]> {
  const rows = await getRowsCoSp();
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
      slug: `cosp-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Colorado Springs",
      // Prefer the row-derived centroid when we have one; fall back
      // to the hardcoded DIVISION_CENTROIDS so a quiet division
      // doesn't get a (0, 0) centroid.
      centroid: e.count > 0
        ? { lat: e.latSum / e.count, lng: e.lngSum / e.count }
        : (DIVISION_CENTROIDS[name] ?? { lat: 38.835, lng: -104.825 }),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForCoSpSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("cosp-") ? s.slice(5) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const coloradoSpringsAdapter: CrimeDataAdapter = {
  name: "colorado-springs-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsCoSp();
    const label = labelForCoSpSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    // Risk thresholds tuned to the typical CSPD per-division volume
    // (~25k-150k incidents per division across the full dataset).
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 1500 ? 5 : inArea.length > 800 ? 4 : inArea.length > 400 ? 3 : inArea.length > 150 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsCoSp();
    const label = labelForCoSpSlug(area, rows);
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
