import { CrimeCategory } from "../crime-category.js";
import { readJson } from "../lib/http.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";

// Pittsburgh — Monthly Criminal Activity (WPRDC CKAN).
// Resource bd41992a-987a-4cca-8798-fbe1cd946b07 on data.wprdc.org. The dataset
// republishes the City of Pittsburgh's monthly criminal-activity exports as a
// CKAN datastore, updated routinely.
//
// Three reasons this one's a good adapter:
//   1. PBP publishes the FBI NIBRS group directly in `NIBRS_Crime_Against`
//      (Person / Property / Society / Group B) — no inference needed.
//   2. Every row has a `Neighborhood` tag from the city's 90 official
//      named neighborhoods plus `XCOORD` (lng) / `YCOORD` (lat).
//   3. No demographic columns are published on this dataset.

// We use the CKAN `datastore_search` action instead of `datastore_search_sql`.
// Both can read the same resource, but the SQL endpoint was returning empty
// payloads to our Vercel functions in production while working fine from
// other clients — likely a per-action rate-limit / IP-block on WPRDC's side.
// `datastore_search` accepts `sort` + `fields` as plain query params and
// has proven reliable.
const SEARCH_BASE = "https://data.wprdc.org/api/3/action/datastore_search";
const RESOURCE_ID = "bd41992a-987a-4cca-8798-fbe1cd946b07";
// v26 bump 5k → 30k. Pittsburgh PERSONS rate was running 2.3×
// under FBI baseline; deeper cache window improves rate fidelity.
const ROW_LIMIT = 30_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; }, "pittsburgh-ckan");

interface PghRow {
  Report_Number?: string;
  ReportedDate?: string;
  ReportedTime?: string;
  NIBRS_Coded_Offense?: string;
  NIBRS_Offense_Code?: string;
  NIBRS_Offense_Category?: string;
  NIBRS_Offense_Type?: string;
  NIBRS_Crime_Against?: string;
  NIBRS_Offense_Grouping?: string;
  Violation?: string;
  XCOORD?: string;
  YCOORD?: string;
  Zone?: string;
  Tract?: string;
  Neighborhood?: string;
  Block_Address?: string;
}

function mapToNibrs(row: PghRow): CrimeCategory {
  // v99 — NIBRS tags Robbery as "Crime Against Property" (the target is
  // property), but FBI UCR Part-1 counts robbery as VIOLENT. Trusting
  // NIBRS_Crime_Against routed all ~1,022 robberies/yr into PROPERTY, so
  // they were dropped from the citywide violent count (PERSONS read 0.47x
  // FBI). Override robbery into PERSONS so isPart1Violent counts it.
  const type = (row.NIBRS_Offense_Type ?? "").trim().toUpperCase();
  if (type === "ROBBERY") return CrimeCategory.PERSONS;
  const c = (row.NIBRS_Crime_Against ?? "").trim().toUpperCase();
  if (c === "PERSON") return CrimeCategory.PERSONS;
  if (c === "PROPERTY") return CrimeCategory.PROPERTY;
  // "Society" + "Group B" (All Other Offenses, traffic, fleeing, etc.) both
  // collapse to SOCIETY for our three-category breakdown.
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "Pittsburgh Bureau of Police Monthly Criminal Activity (Western Pennsylvania Regional Data Center, CKAN)",
  datasetUrl: "https://data.wprdc.org/dataset/monthly-criminal-activity-dashboard",
  recency: "Refreshed monthly by PBP via WPRDC; latest extract typically lags ~30 days",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the City of Pittsburgh Bureau of Police and " +
    "aggregated to one of 90 named city neighborhoods. The NIBRS group " +
    "(Person/Property/Society/Group B) is published per row by PBP. " +
    "Society + Group B are collapsed into SOCIETY for CommunitySafe's three- " +
    "category breakdown.",
};

function safeIso(date: string | undefined, time: string | undefined): string {
  if (!date) return new Date(0).toISOString();
  const isoDateTime = time ? `${date}T${time}:00` : `${date}T00:00:00`;
  // v99 — merged ReportedDate+ReportedTime is a naive Eastern wall-clock;
  // route through cityLocalToUtcIso so the hour bucket is correct.
  return cityLocalToUtcIso(isoDateTime, "America/New_York");
}

async function fetchPittsburgh(): Promise<Incident[]> {
  // Plain `datastore_search`: resource_id + sort + limit + fields. The
  // `fields` param narrows the wire payload to the columns we use (no
  // demographic columns exist on this dataset, but enumerating fields
  // keeps the request shape stable and the response under ~1MB). We
  // can't filter "Neighborhood IS NOT NULL" via this endpoint, so we
  // drop empty-neighborhood rows client-side after fetch.
  const fields = [
    "Report_Number", "ReportedDate", "ReportedTime",
    "NIBRS_Coded_Offense", "NIBRS_Offense_Type", "NIBRS_Crime_Against",
    "Violation", "XCOORD", "YCOORD", "Zone", "Tract", "Neighborhood",
    "Block_Address",
  ].join(",");
  const params = new URLSearchParams({
    resource_id: RESOURCE_ID,
    limit: String(ROW_LIMIT),
    sort: "ReportedDate desc, ReportedTime desc",
    fields,
  });
  const url = `${SEARCH_BASE}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
  });
  if (!res.ok) throw new Error(`Pittsburgh CKAN ${res.status}`);
  const body = await readJson(res) as { result?: { records?: PghRow[] } };
  const rows = (body.result?.records ?? []).filter((r) => (r.Neighborhood ?? "").trim().length > 0);
  // PBP can emit multiple rows per Report_Number (one per offense). Dedup
  // so each incident contributes a single card — keep the first row, which
  // is the highest NIBRS hierarchy after the ORDER BY date desc.
  const seen = new Set<string>();
  const out: Incident[] = [];
  for (const r of rows) {
    const id = r.Report_Number ?? "";
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const lng = Number(r.XCOORD);
    const lat = Number(r.YCOORD);
    out.push({
      id: `pgh-${id || out.length}`,
      area: r.Neighborhood?.trim() ?? "Unknown",
      occurredAt: safeIso(r.ReportedDate, r.ReportedTime),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.NIBRS_Offense_Type?.trim() || r.NIBRS_Coded_Offense?.trim() || r.Violation?.trim() || "Unknown",
      beat: r.Zone ?? null,
      blockLabel: r.Block_Address ?? undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lng) && lng !== 0 ? lng : undefined,
    });
  }
  return out;
}

// v107 — in-flight fetch dedup (the OOM-guard Detroit added in v94): the
// dispatcher fans a per-area Promise.all over every neighbourhood, so a cold
// cache previously fired N concurrent full fetches. Concurrent callers now
// await the same promise.
let inFlightPittsburghFetch: Promise<Incident[]> | null = null;
export async function getRowsPittsburgh(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightPittsburghFetch) return inFlightPittsburghFetch;
  inFlightPittsburghFetch = (async () => {
    try {
      const rows = await fetchPittsburgh();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[pgh] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightPittsburghFetch = null;
    }
  })();
  return inFlightPittsburghFetch;
}

export async function getDiscoveredAreasPittsburgh(): Promise<KnownArea[]> {
  const rows = await getRowsPittsburgh();
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
      slug: `pgh-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Pittsburgh",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForPittsburghSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("pgh-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const pittsburghAdapter: CrimeDataAdapter = {
  name: "pittsburgh-ckan",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsPittsburgh();
    const label = labelForPittsburghSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [40, 150, 300, 600]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsPittsburgh();
    const label = labelForPittsburghSlug(area, rows);
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
