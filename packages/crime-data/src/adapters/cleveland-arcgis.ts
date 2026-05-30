import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";
import { clevelandPolygons } from "../data/cleveland-neighborhoods.js";

// v89 — static seed list from the bundled neighborhood polygons.
// Returned by discover() when the in-process row cache is cold so
// /geo/areas?city=cleveland never returns [] (which used to leave
// the map showing only the tile layer for the 30s cold-window).
// Each polygon's centroid is approximated from the bbox midpoint.
const STATIC_CLEVELAND_AREAS: KnownArea[] = clevelandPolygons.map((p) => {
  let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
  const rings: number[][][] = p.geometry.type === "Polygon"
    ? (p.geometry.coordinates as number[][][])
    : (p.geometry.coordinates as number[][][][]).flat();
  for (const ring of rings) for (const [lng, lat] of ring) {
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
  }
  return {
    slug: `cle-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    label: p.name,
    jurisdiction: "Cleveland",
    centroid: { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 },
  };
});

// Cleveland — Crime_Incidents_P1RMS on services3.arcgis.com
// (owner: opendataCLE). This is CDP's published Part-1 Records
// Management System feed — NIBRS-classified incident reports, NOT
// raw CAD dispatches.
//
// v95p14 — switched from CAD_Police (Calls for Service) to
// Crime_Incidents_P1RMS. The CAD layer was a wall of dispatch codes
// requiring keyword matching to approximate NIBRS classes; after
// every cycle of broadening/tightening the keyword list, the
// adapter still landed 15.8× under FBI baseline (under-count guard
// suppressed grade to N/A). P1RMS solves this at the source: each
// row carries an `IncidentDesc` field that already maps directly
// to NIBRS Part-1 categories ("Aggravated Assault", "Robbery",
// "Burglary/Breaking and Entering", "Motor Vehicle Theft", "All
// Other Larceny", etc.) plus the canonical NEIGHBORHOOD label
// (35 statistical planning areas, matches our static polygon set).
// Removed from CFS_CALIBRATION in safety-score.ts since this is
// NIBRS data, not CFS dispatches.
//
// 44,821 rows total (~2 years of Part-1 incidents at CDP's volume).

const BASE = "https://services3.arcgis.com/dty2kHktVXHrqO8i/arcgis/rest/services/Crime_Incidents_P1RMS/FeatureServer/0/query";
const PAGE_SIZE = 2000;
// 25 pages × 2k = 50k records — covers the whole P1RMS table with
// headroom. The dataset is bounded (CDP backfills monthly) so we
// don't need the 60-page width the CFS feed required.
const PAGES = 25;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; });

interface CleRow {
  PrimaryKey?: string;
  CaseNumber?: string;
  District?: string;
  IncidentDesc?: string;        // NIBRS-style class, e.g. "Aggravated Assault"
  StatDesc?: string;             // Ohio statutory description
  ReportedDate?: number;         // epoch ms
  OffenseDate?: number;          // epoch ms
  NEIGHBORHOOD?: string;
  WARD_2026?: string;
  Address_Public?: string;
}

// v95p14 — Cleveland's P1RMS layer pre-classifies each row into a
// FBI NIBRS Part-1 incident type via IncidentDesc. Map those
// directly; no keyword matching guesswork needed.
//
// PERSONS Part-1 (UCR Violent): Aggravated Assault, Robbery,
// Murder/Nonnegligent Manslaughter, Rape.
// PROPERTY Part-1 (UCR Property): Burglary/Breaking and Entering,
// Larceny (any subtype), Motor Vehicle Theft, Arson.
// Everything else (Simple Assault, Intimidation, Drug Equipment,
// Weapon Law Violations, Family Offenses, DUI, etc.) → SOCIETY,
// which the safety-score doesn't grade against.
const PERSONS_NIBRS: ReadonlySet<string> = new Set([
  "Aggravated Assault",
  "Robbery",
  "Murder/Nonnegligent Manslaughter",
  "Rape",
  "Justifiable Homicide",
  "Negligent Manslaughter",
  "Kidnapping/Abduction",
  "Forcible Rape",
  "Sex Offenses",
]);
const PROPERTY_NIBRS: ReadonlySet<string> = new Set([
  "Burglary/Breaking and Entering",
  "Motor Vehicle Theft",
  "All Other Larceny",
  "Theft From Building",
  "Theft From Motor Vehicle",
  "Theft of Motor Vehicle Parts or Accessories",
  "Shoplifting",
  "Pocket-Picking",
  "Purse-Snatching",
  "Arson",
]);

function classify(incidentDesc: string | undefined): CrimeCategory {
  if (!incidentDesc) return CrimeCategory.SOCIETY;
  const trimmed = incidentDesc.trim();
  if (PERSONS_NIBRS.has(trimmed)) return CrimeCategory.PERSONS;
  if (PROPERTY_NIBRS.has(trimmed)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "Cleveland Division of Police — Part-1 Crime Incidents (NIBRS RMS, City of Cleveland Open Data)",
  datasetUrl: "https://opendata.clevelandohio.gov/datasets/clevelandgis::crime-incidents",
  recency: "Refreshed regularly by CDP from the Records Management System",
  granularity: "neighborhood",
  disclaimer:
    "These are Cleveland Division of Police Part-1 Crime Incident records — the " +
    "same FBI NIBRS-classified reports CDP submits to UCR. CommunitySafe aggregates " +
    "by CDP's Statistical Planning Area (NEIGHBORHOOD field) and reports the violent " +
    "(Aggravated Assault / Robbery / Murder / Rape) and property (Burglary / Larceny " +
    "/ Motor Vehicle Theft / Arson) totals. Some incidents may be reclassified or " +
    "unfounded by CDP investigators after publication.",
};

interface CleFeature {
  attributes: CleRow;
  geometry?: { x?: number; y?: number };
}

async function fetchPageOnce(url: URL): Promise<CleFeature[]> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
  });
  if (!res.ok) throw new Error(`Cleveland ArcGIS ${res.status}`);
  const body = await res.json() as { features?: CleFeature[]; error?: { code?: number; message?: string } };
  if (body.error) throw new Error(`Cleveland ArcGIS error ${body.error.code}: ${body.error.message}`);
  return body.features ?? [];
}

async function fetchPage(offset: number): Promise<CleFeature[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", "NEIGHBORHOOD IS NOT NULL");
  url.searchParams.set("outFields", "PrimaryKey,CaseNumber,District,IncidentDesc,StatDesc,ReportedDate,OffenseDate,NEIGHBORHOOD,WARD_2026,Address_Public");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  // Same OBJECTID DESC sort rationale as the prior CAD layer — Esri
  // pagination on a non-unique date column under-counts.
  url.searchParams.set("orderByFields", "ReportedDate DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  // v96 — Cleveland's ArcGIS host throws transient "fetch failed"
  // errors (undici TLS/connect aborts) during cold-start cycles
  // before its CDN edge has been warmed. The warm-worker logs
  // showed four boot-cycle pages all failing at once. Add a
  // single retry with a 250 ms backoff for the boot scenario;
  // steady-state cycles aren't affected (they hit the CDN
  // edge and never need the retry).
  try {
    return await fetchPageOnce(url);
  } catch (err) {
    const msg = (err as Error).message || "";
    // Only retry the transient connect-failure class. 4xx/5xx
    // SHOULD fail fast — retrying a 400 just wastes work.
    if (!/fetch failed|ECONNRESET|UND_ERR|socket hang up|terminated/i.test(msg)) {
      throw new Error(`${msg} offset=${offset}`);
    }
    await new Promise((r) => setTimeout(r, 250));
    try {
      return await fetchPageOnce(url);
    } catch (err2) {
      throw new Error(`${(err2 as Error).message} offset=${offset} (after 1 retry)`);
    }
  }
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
      results[idx] = await fetcher(offsets[idx]).catch((err) => {
        console.warn(`[cle] page offset=${offsets[idx]} failed: ${(err as Error).message}`);
        return [] as T[];
      });
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchCleveland(): Promise<Incident[]> {
  // Same concurrency posture as the prior layer; Cleveland's host
  // throttles parallel bursts above 4.
  const pages = await fetchPagesBounded<CleFeature>(PAGES, PAGE_SIZE, fetchPage, 4);
  const features = pages.flat();
  const out: Incident[] = [];
  for (const f of features) {
    const r = f.attributes;
    const desc = (r.IncidentDesc ?? "").trim();
    // Skip rows with no valid timestamp (data quality on this layer).
    const ts = r.ReportedDate ?? r.OffenseDate;
    if (!ts) continue;
    // Skip the "No Crime" / "-" placeholder rows — these are case
    // entries that CDP later marked as not actually criminal.
    if (!desc || desc === "-" || desc.toLowerCase() === "no crime") continue;
    out.push({
      id: `cle-${r.PrimaryKey ?? r.CaseNumber ?? out.length}`,
      area: r.NEIGHBORHOOD?.trim() || "Unknown",
      occurredAt: new Date(ts).toISOString(),
      nibrsCategory: classify(desc),
      ibrOffenseDescription: titleCaseOffense(desc),
      beat: r.District ? `District ${r.District}` : null,
      blockLabel: undefined,
      lat: typeof f.geometry?.y === "number" && f.geometry.y !== 0 ? f.geometry.y : undefined,
      lng: typeof f.geometry?.x === "number" && f.geometry.x !== 0 ? f.geometry.x : undefined,
    });
  }
  return out;
}

// v94 — in-flight Promise dedup (see detroit-arcgis.ts for rationale).
let inFlightCleFetch: Promise<Incident[]> | null = null;

export async function getRowsCleveland(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightCleFetch) return inFlightCleFetch;
  inFlightCleFetch = (async () => {
    try {
      const rows = await fetchCleveland();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[cle] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightCleFetch = null;
    }
  })();
  return inFlightCleFetch;
}

function buildClevelandAreas(rows: Incident[]): KnownArea[] {
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

// v77 — pre-rollout audit caught the /geo/areas?city=cleveland route
// returning empty/timing-out on cold cache: the synchronous fetch
// blocked for ~30s while the bounded 30-page CFS pull ran, and the
// HTTP client gave up before the response landed. Discover now uses
// a last-known-good pattern — return what's already in the in-process
// cache if anything is there, otherwise kick off a refresh in the
// background and return [] immediately. The warm-worker (which runs
// 30s after boot) populates the cache before the first user request.
export async function getDiscoveredAreasCleveland(): Promise<KnownArea[]> {
  if (cache && cache.rows.length > 0) {
    return buildClevelandAreas(cache.rows);
  }
  // v89 — return the static bundled neighborhood list when the adapter
  // cache is cold (instead of [] which left the map blank for ~30s
  // after every container restart). Fire-and-forget the upstream
  // refresh so live data takes over as soon as the warm cycle finishes.
  void getRowsCleveland().catch(() => {});
  return STATIC_CLEVELAND_AREAS;
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
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [40, 120, 250, 500]);
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
