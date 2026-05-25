import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import type { KnownArea } from "../neighborhoods.js";

// Seattle — SPD Crime Data.
// Socrata dataset tazs-3rd5 on data.seattle.gov. NIBRS-coded by SPD, which
// means we can read PERSONS / PROPERTY / SOCIETY directly off the row
// instead of inferring it from offense names.
// Doc: https://dev.socrata.com/foundry/data.seattle.gov/tazs-3rd5

const BASE = "https://data.seattle.gov/resource/tazs-3rd5.json";
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

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

function titleCase(s: string): string {
  return s.toLowerCase().split(/\s+/).map((w) => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}

async function fetchSeattle(): Promise<Incident[]> {
  const url = new URL(BASE);
  url.searchParams.set("$select", "offense_id,offense_date,neighborhood,precinct,beat,offense_category,nibrs_offense_code_description,nibrs_crime_against_category,latitude,longitude");
  url.searchParams.set("$order", "offense_date DESC");
  url.searchParams.set("$limit", "50000");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/CommunitySafe)" },
  });
  if (!res.ok) throw new Error(`Seattle SODA ${res.status} ${url}`);
  const rows = (await res.json()) as SodaRow[];
  return rows.map((r, i) => {
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    // SPD prints neighborhood in ALL CAPS ("BITTERLAKE", "HIGHLAND PARK"). We
    // title-case it on intake so it reads naturally everywhere and matches
    // the polygon file's casing.
    const rawNbhd = r.neighborhood?.trim();
    const area = rawNbhd && rawNbhd !== "UNKNOWN" ? titleCase(rawNbhd) : "Unknown";
    return {
      id: `sea-${r.offense_id ?? i}`,
      area,
      occurredAt: r.offense_date ?? new Date(0).toISOString(),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.nibrs_offense_code_description?.trim() || r.offense_category?.trim() || "Unknown",
      beat: r.beat ?? null,
      blockLabel: undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lon) && lon !== 0 ? lon : undefined,
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
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 2000 ? 5 : inArea.length > 1200 ? 4 : inArea.length > 600 ? 3 : inArea.length > 200 ? 2 : 1;
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
