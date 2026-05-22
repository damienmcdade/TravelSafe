import "server-only";
import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";

// Montgomery County, MD — Montgomery County Police (MCPD) Crime feed on
// data.montgomerycountymd.gov (Socrata, dataset icn6-v9z3).
//
// MCPD publishes the FBI NIBRS classification per row in `crimename1`
// ("Crime Against Person" / "Crime Against Property" / "Crime Against
// Society" / "Crime Against Not a Crime") and tags each row with a
// district name (BETHESDA, SILVER SPRING, ROCKVILLE, WHEATON, GERMANTOWN,
// MONTGOMERY VILLAGE, TAKOMA PARK) plus lat/lng.
//
// No demographic columns are published on this feed.

const BASE = "https://data.montgomerycountymd.gov/resource/icn6-v9z3.json";
const ROW_LIMIT = 5_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface MoCoRow {
  incident_id?: string;
  case_number?: string;
  date?: string;
  start_date?: string;
  nibrs_code?: string;
  crimename1?: string;
  crimename2?: string;
  crimename3?: string;
  district?: string;
  city?: string;
  zip_code?: string;
  beat?: string;
  sector?: string;
  police_district_number?: string;
  latitude?: string;
  longitude?: string;
}

function titleCase(s: string): string {
  return s.toLowerCase().split(/\s+/).map((w) => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}

function mapToNibrs(row: MoCoRow): CrimeCategory {
  const c = (row.crimename1 ?? "").toUpperCase();
  if (c.includes("PERSON")) return CrimeCategory.PERSONS;
  if (c.includes("PROPERTY")) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "Montgomery County Police Crime (Montgomery County MD Open Data)",
  datasetUrl: "https://data.montgomerycountymd.gov/Public-Safety/Crime/icn6-v9z3",
  recency: "Refreshed daily by MCPD",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Montgomery County Police Department and " +
    "aggregated to one of seven MCPD policing districts (Bethesda, Silver Spring, " +
    "Rockville, Wheaton, Germantown, Montgomery Village, Takoma Park). NIBRS " +
    "group is published per row by MCPD.",
};

function safeIso(raw: string | null | undefined): string {
  if (!raw) return new Date(0).toISOString();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

async function fetchMoCo(): Promise<Incident[]> {
  // Explicit $select — keep only what we use. MCPD doesn't publish
  // demographics on this feed but enumerating outFields keeps the
  // request shape stable and small.
  const select = "incident_id,case_number,start_date,nibrs_code,crimename1,crimename2,crimename3,district,beat,sector,police_district_number,latitude,longitude";
  const u = `${BASE}?$limit=${ROW_LIMIT}&$select=${select}&$order=start_date%20DESC&$where=district%20IS%20NOT%20NULL%20AND%20latitude%20IS%20NOT%20NULL`;
  const res = await fetch(u, {
    headers: { Accept: "application/json", "User-Agent": "TravelSafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
  });
  if (!res.ok) throw new Error(`MoCo Socrata ${res.status}`);
  const rows = (await res.json()) as MoCoRow[];
  return rows.map((r, i) => {
    const lat = Number(r.latitude);
    const lng = Number(r.longitude);
    const districtRaw = r.district?.trim();
    const area = districtRaw && districtRaw !== "OTHER" ? titleCase(districtRaw) : "Unknown";
    const descParts = [r.crimename3, r.crimename2].filter((p) => p && p.trim());
    return {
      id: `moco-${r.incident_id ?? r.case_number ?? i}`,
      area,
      occurredAt: safeIso(r.start_date),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: descParts.join(" — ") || "Unknown",
      beat: r.police_district_number ?? r.beat ?? null,
      blockLabel: undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lng) && lng !== 0 ? lng : undefined,
    };
  });
}

export async function getRowsMontgomeryCounty(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchMoCo();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[moco] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasMontgomeryCounty(): Promise<KnownArea[]> {
  const rows = await getRowsMontgomeryCounty();
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
      slug: `moco-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Montgomery County",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForMoCoSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("moco-") ? s.slice(5) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const montgomeryCountyAdapter: CrimeDataAdapter = {
  name: "montgomery-county-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsMontgomeryCounty();
    const label = labelForMoCoSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 1200 ? 5 : inArea.length > 700 ? 4 : inArea.length > 300 ? 3 : inArea.length > 80 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsMontgomeryCounty();
    const label = labelForMoCoSlug(area, rows);
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
