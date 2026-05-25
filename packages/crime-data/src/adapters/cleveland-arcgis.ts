import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import type { KnownArea } from "../neighborhoods.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";

// Cleveland — Cleveland Division of Police Calls for Service (CAD) on
// services3.arcgis.com (owner: opendataCLE). The feed is dispatched CFS,
// not closed reports, so it includes administrative records ("CPOP FOLLOW
// UP", "PARK, WALK & TALK", "TRAFFIC STOP", "ALARM - BURGLAR"). We keep
// only the rows that represent an actual citizen report or officer-
// initiated incident relating to a crime (assault/property/society
// signals) — the rest are filtered out at ingest so the per-neighborhood
// counts read as comparable to other cities' NIBRS-only feeds.
//
// Cleveland publishes 33 named neighborhoods (Statistical Planning
// Areas) and we use them directly. Lat/lng on every retained row.
// No demographic columns are published on this layer.

const BASE = "https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/CAD_Police/FeatureServer/0/query";
const PAGE_SIZE = 2000;
// 30 pages × 2,000 = 60,000 rows. Cleveland's CFS feed runs ~1,000
// incidents/day; at the earlier 10k-row limit the cache spanned
// ~10 days, which safety-score then annualized over 365 days with
// an absurd 36× multiplier — citywide rates got noisy enough that
// grade-flipping was a regular occurrence on cache refreshes.
// 60k rows ≈ 60 days, comfortably above the 30-day "low confidence"
// trip-wire and stable enough that grades don't ping-pong.
const PAGES = 30;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface CleRow {
  IncidentNumber?: string;
  eid?: string;
  IncidentDate?: number;
  IncidentTypeDescription?: string;
  DispositionDescription1?: string;
  address?: string;
  neighborhood?: string;
  police_district?: string;
  ward_2026?: string;
  latitude?: number;
  longitude?: number;
}

// Cleveland CFS uses verbose all-caps descriptions. Group them into NIBRS
// categories with explicit substring lists so the user-facing card mix is
// meaningful and not dominated by administrative entries.
//
// Tightened 2026-05-23: dropped CFS-only categories that were inflating
// Cleveland's citywide ratio to 27× national. Removed generic bucket
// labels ("PERSON CRIME", "PROPERTY CRIME" — these are CDP's own
// category headers, not specific offenses), MH dispatches (CRISIS
// INTERVENTION), sensor events (SHOTSPOTTER alone), and broad public-
// order calls (DISTURBANCE, NUISANCE) that don't map to NIBRS reports.
const PERSONS_KEYS = [
  "ASSAULT", "FIGHT", "THREATEN", "THREATS", "DOM VIOL", "FAMILY TROUBLE",
  "ROBBERY", "HOMICIDE", "MURDER", "KIDNAP", "ABDUCT",
  "PERSON THREAT", "INTIMIDAT", "RAPE", "SEX OFFENSE", "STALKING",
];
const PROPERTY_KEYS = [
  "BURGLAR", "THEFT", "AUTO RECOVERY", "STOLEN",
  "DAMAGE", "VANDAL", "ARSON", "FRAUD", "FORGERY", "EMBEZ", "LARC",
  "SHOPLIFT",
];
const SOCIETY_KEYS = [
  "WEAPON", "DRUG", "NARCOTIC", "TRESPASS", "DISORDERLY", "OUI", "DUI",
];
// Anything that doesn't match the three lists above is administrative
// (officer-initiated patrol, follow-ups, traffic stops, alarms, welfare
// checks, MH responses) and is filtered out at ingest.
function classify(desc: string): CrimeCategory | null {
  const t = desc.toUpperCase();
  if (PERSONS_KEYS.some((k) => t.includes(k))) return CrimeCategory.PERSONS;
  if (PROPERTY_KEYS.some((k) => t.includes(k))) return CrimeCategory.PROPERTY;
  if (SOCIETY_KEYS.some((k) => t.includes(k))) return CrimeCategory.SOCIETY;
  return null;
}

const PROVENANCE: DataProvenance = {
  source: "Cleveland Division of Police — Calls for Service (City of Cleveland Open Data, ArcGIS Feature Server)",
  datasetUrl: "https://data.clevelandohio.gov/datasets/clevelandgis::police-calls-for-service",
  recency: "Refreshed near-daily by CDP; includes some same-day dispatches",
  granularity: "neighborhood",
  disclaimer:
    "These are Cleveland Police Calls for Service (dispatched calls) rather than " +
    "closed NIBRS reports. CommunitySafe filters out administrative dispatches " +
    "(traffic stops, alarms, follow-ups, community-engagement entries) and keeps " +
    "only rows that represent a real reported persons/property/society offense. " +
    "Some incidents may later be reclassified or unfounded by CDP investigators.",
};

async function fetchPage(offset: number): Promise<CleRow[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", "latitude IS NOT NULL AND latitude <> 0 AND neighborhood IS NOT NULL");
  url.searchParams.set("outFields", "IncidentNumber,eid,IncidentDate,IncidentTypeDescription,DispositionDescription1,address,neighborhood,police_district,ward_2026,latitude,longitude");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "IncidentDate DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("f", "json");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/CommunitySafe)" },
  });
  if (!res.ok) throw new Error(`Cleveland ArcGIS ${res.status} offset=${offset}`);
  const body = await res.json() as { features?: Array<{ attributes: CleRow }> };
  return (body.features ?? []).map((f) => f.attributes);
}

// v63 — bounded concurrency. Cleveland's ArcGIS endpoint rate-limits
// or silently drops large parallel bursts: probing showed 30 parallel
// page requests all returning [], while single sequential requests
// work fine. The earlier Promise.all-all-30 was responsible for the
// adapter being completely empty in production (observable as
// "cleveland: 0 rows" in the all-adapter freshness audit, despite a
// healthy upstream returning fresh 2026-05-25 data via direct curl).
// 4-at-a-time keeps the total cycle under ~30s while staying inside
// whatever per-IP concurrency cap the host enforces.
async function fetchPagesBounded<T>(
  count: number,
  pageSize: number,
  fetcher: (offset: number) => Promise<T[]>,
  concurrency: number,
): Promise<T[][]> {
  const offsets = Array.from({ length: count }, (_, i) => i * pageSize);
  const results: T[][] = new Array(count);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, count) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= offsets.length) return;
      results[idx] = await fetcher(offsets[idx]).catch(() => [] as T[]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchCleveland(): Promise<Incident[]> {
  // Concurrency tuning history: at 30 (all-parallel) every page
  // returned empty (rate-limit). At 6 the host throttled mid-cycle
  // and we collected fewer rows than at 4. 4 is the sweet spot
  // (~5min cold, ~9.8k rows). The warm-worker's 4-min interval
  // has an inFlight guard so the slight overlap doesn't compound.
  const pages = await fetchPagesBounded<CleRow>(PAGES, PAGE_SIZE, fetchPage, 4);
  const rows = pages.flat();
  const out: Incident[] = [];
  for (const r of rows) {
    const desc = r.IncidentTypeDescription?.trim() ?? "";
    const cat = classify(desc);
    if (cat == null) continue;
    out.push({
      id: `cle-${r.eid ?? r.IncidentNumber ?? out.length}`,
      area: r.neighborhood?.trim() || "Unknown",
      occurredAt: r.IncidentDate ? new Date(r.IncidentDate).toISOString() : new Date(0).toISOString(),
      nibrsCategory: cat,
      ibrOffenseDescription: titleCaseOffense(desc),
      beat: r.police_district ? `District ${r.police_district}` : null,
      blockLabel: undefined,
      lat: typeof r.latitude === "number" && r.latitude !== 0 ? r.latitude : undefined,
      lng: typeof r.longitude === "number" && r.longitude !== 0 ? r.longitude : undefined,
    });
  }
  return out;
}

export async function getRowsCleveland(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchCleveland();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[cle] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasCleveland(): Promise<KnownArea[]> {
  const rows = await getRowsCleveland();
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
      slug: `cle-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Cleveland",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForClevelandSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("cle-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const clevelandAdapter: CrimeDataAdapter = {
  name: "cleveland-arcgis",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsCleveland();
    const label = labelForClevelandSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 500 ? 5 : inArea.length > 250 ? 4 : inArea.length > 120 ? 3 : inArea.length > 40 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsCleveland();
    const label = labelForClevelandSlug(area, rows);
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
