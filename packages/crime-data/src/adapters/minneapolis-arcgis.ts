import { CrimeCategory } from "../crime-category.js";
import { readJson } from "../lib/http.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";

// Minneapolis — MPD Crime_Data on services.arcgis.com.
// ArcGIS FeatureServer, refreshed daily. Minneapolis publishes the FBI
// NIBRS classification per row in the `NIBRS_Crime_Against` column
// (Person / Property / Society / "Non NIBRS Data") and tags each row with
// the official Minneapolis neighborhood (87 named neighborhoods like
// Phillips West, Downtown West, Standish, Loring Park…).
//
// The dataset mixes multiple `Type` values: "Crime Offenses (NIBRS)" are
// the actual recorded crimes; "Shots Fired Calls", "Gunshot Wound
// Victims", and "Additional Crime Metrics" are useful CFS metrics but
// not actual recorded crime. We filter to the NIBRS rows only so the
// area stats stay comparable across cities.
//
// No demographic columns are published on this layer at all.

const BASE = "https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/Crime_Data/FeatureServer/0/query";
const PAGE_SIZE = 2000;
// v26 bump 5 → 15 (10k → 30k rows). Minneapolis publishes ~64k
// NIBRS rows/year; the prior 10k cache only spanned ~6 weeks of
// the city's actual volume, so annualizing 10k * 365/(window~30)
// undershot the true rate by ~5×. 30k covers ~5 months which is
// dense enough that the per-100k math converges on the FBI
// baseline.
const PAGES = 15;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; }, "minneapolis-arcgis");

interface MplsRow {
  Case_Number?: string;
  Type?: string;
  Reported_Date?: number;
  Occurred_Date?: number;
  NIBRS_Crime_Against?: string;
  NIBRS_Code?: string;
  Offense_Category?: string;
  Offense?: string;
  Address?: string;
  Precinct?: number;
  Neighborhood?: string;
  Ward?: number;
  Latitude?: number;
  Longitude?: number;
}

function mapToNibrs(row: MplsRow): CrimeCategory {
  // Robbery is NIBRS "Crime Against Property" but FBI UCR Part-1 VIOLENT — force
  // it to PERSONS before the crime-against passthrough (taxonomy invariant).
  if ((row.NIBRS_Code ?? "").trim() === "120" ||
      `${row.Offense ?? ""} ${row.Offense_Category ?? ""}`.toLowerCase().includes("robbery")) {
    return CrimeCategory.PERSONS;
  }
  const c = (row.NIBRS_Crime_Against ?? "").trim().toUpperCase();
  if (c === "PERSON" || c === "PERSONS") return CrimeCategory.PERSONS;
  if (c === "PROPERTY") return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "Minneapolis Crime_Data (City of Minneapolis, ArcGIS Feature Server)",
  datasetUrl: "https://opendata.minneapolismn.gov/datasets/cityoflakes::crime-data",
  recency: "Refreshed daily by MPD; NIBRS-classified per row by MPD",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Minneapolis Police Department and aggregated " +
    "to one of 87 named neighborhoods, with the FBI NIBRS group (Person / Property / " +
    "Society) attached to each row. Non-NIBRS metrics (shots-fired calls, gunshot " +
    "wound victims) are excluded so the stats stay comparable across cities.",
};

async function fetchPage(offset: number): Promise<MplsRow[]> {
  const url = new URL(BASE);
  // Only "Crime Offenses (NIBRS)" rows — skip the shots-fired CFS and aggregate metrics.
  url.searchParams.set("where", "Type='Crime Offenses (NIBRS)' AND Latitude IS NOT NULL AND Latitude <> 0");
  url.searchParams.set("outFields", "Case_Number,Type,Reported_Date,Occurred_Date,NIBRS_Crime_Against,NIBRS_Code,Offense_Category,Offense,Address,Precinct,Neighborhood,Ward,Latitude,Longitude");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "Reported_Date DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true"); // v87 — Esri edge cache
  url.searchParams.set("f", "json");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Minneapolis ArcGIS ${res.status} offset=${offset}`);
  const body = await readJson(res) as { features?: Array<{ attributes: MplsRow }> };
  return (body.features ?? []).map((f) => f.attributes);
}

async function fetchMinneapolis(): Promise<Incident[]> {
  const pages = await Promise.all(
    Array.from({ length: PAGES }, (_, i) => fetchPage(i * PAGE_SIZE).catch(() => [] as MplsRow[])),
  );
  const rows = pages.flat();
  // Drop rows with no parseable date — see charlotte-arcgis comment.
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rawDate = r.Occurred_Date ?? r.Reported_Date;
    if (rawDate == null) continue;
    const d = new Date(rawDate);
    if (Number.isNaN(d.getTime()) || d.getTime() <= 0) continue;
    const lat = r.Latitude;
    const lng = r.Longitude;
    const area = r.Neighborhood?.trim() || "Unknown";
    out.push({
      id: `mpls-${r.Case_Number ?? i}`,
      area,
      occurredAt: d.toISOString(),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.Offense?.trim() || r.Offense_Category?.trim() || "Unknown",
      beat: r.Precinct != null ? `Precinct ${r.Precinct}` : null,
      blockLabel: undefined,
      lat: typeof lat === "number" && lat !== 0 ? lat : undefined,
      lng: typeof lng === "number" && lng !== 0 ? lng : undefined,
    });
  }
  return out;
}

// v107 — in-flight fetch dedup (the OOM-guard Detroit added in v94): the
// dispatcher fans a per-area Promise.all over every neighbourhood, so a cold
// cache previously fired N concurrent full fetches. Concurrent callers now
// await the same promise.
let inFlightMinneapolisFetch: Promise<Incident[]> | null = null;
export async function getRowsMinneapolis(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightMinneapolisFetch) return inFlightMinneapolisFetch;
  inFlightMinneapolisFetch = (async () => {
    try {
      const rows = await fetchMinneapolis();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[mpls] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightMinneapolisFetch = null;
    }
  })();
  return inFlightMinneapolisFetch;
}

export async function getDiscoveredAreasMinneapolis(): Promise<KnownArea[]> {
  const rows = await getRowsMinneapolis();
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
      slug: `mpls-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Minneapolis",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForMinneapolisSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("mpls-") ? s.slice(5) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const minneapolisAdapter: CrimeDataAdapter = {
  name: "minneapolis-arcgis",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsMinneapolis();
    const label = labelForMinneapolisSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [40, 100, 200, 400]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsMinneapolis();
    const label = labelForMinneapolisSlug(area, rows);
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
