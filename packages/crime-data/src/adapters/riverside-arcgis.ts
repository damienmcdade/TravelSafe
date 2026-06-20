import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT, readJson, fetchWithRetry } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";

// Riverside, CA — Riverside Police Department "Crime (Last Year to Date)"
// ArcGIS FeatureServer (View_CrimesRPD layer 4). Incident-level NIBRS rows
// with point geometry (native WKID 102100; we request outSR=4326 so ArcGIS
// returns WGS84 — no manual reprojection). Each row carries the city's own
// community name (`COMMUNITY`, 28 official communities), a NIBRS crime-against
// bucket (`IBRCrimeAgainst` = Person/Property/Society), an offense
// description (`nibrsdesc`), and an `offendate` epoch-ms that already carries
// the real incident time-of-day (its Los-Angeles wall clock matches the
// separate `hourofday` field), so we use it directly. We take the community
// straight from the feed — no point-in-polygon needed.
// Source: https://services.arcgis.com/Fu2oOWg1Aw7azh41/arcgis/rest/services/View_CrimesRPD/FeatureServer/4

const BASE =
  "https://services.arcgis.com/Fu2oOWg1Aw7azh41/arcgis/rest/services/View_CrimesRPD/FeatureServer/4/query";
const RIVERSIDE_TZ = "America/Los_Angeles";
const PAGE_SIZE = 2000; // = server maxRecordCount
const WINDOW_DAYS = 400; // a touch over a year so the 365d score window is fully covered
// The layer is a rolling "last year to date" window of ~72k rows; 40 pages
// (80k) covers the 400-day where-clause slice fully with headroom.
const PAGES = 40;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => {
  cache = null;
}, "riverside-arcgis");

interface RiversideFeature {
  attributes: {
    ObjectID?: number;
    rpdunique?: string;
    offendate?: number; // epoch ms — already carries the real incident time-of-day
    hourofday?: number; // hour of day 0-23 (LA local), matches offendate
    nibrsdesc?: string; // NIBRS offense, e.g. "Assault Offenses", "Robbery"
    nibrscode?: string;
    IBRCrimeAgainst?: string; // "Person" | "Property" | "Society" (may be comma-joined)
    COMMUNITY?: string; // official Riverside community name
    rd?: string; // reporting district
    BLOCK_ADDRESS?: string;
  };
  geometry?: { x: number; y: number }; // x=lng, y=lat (WGS84 when outSR=4326)
}

// NIBRS crime-against bucket → CommunitySafe category. Robbery is filed by
// NIBRS (and this feed) under "Crimes Against Property", but the FBI UCR
// counts it as a Part-1 VIOLENT offense, so force it to PERSONS (same
// convention as the Long Beach / Dallas / Saint Paul adapters). For
// multi-offense rows IBRCrimeAgainst is comma-joined; we scan every segment
// and let the most-severe win (PERSONS > PROPERTY > SOCIETY).
function classify(nibrsDesc: string | undefined, crimeAgainst: string | undefined): CrimeCategory {
  if ((nibrsDesc ?? "").toUpperCase().includes("ROBBERY")) return CrimeCategory.PERSONS;
  const segments = (crimeAgainst ?? "")
    .toUpperCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let best: CrimeCategory = CrimeCategory.SOCIETY;
  for (const seg of segments) {
    if (seg === "PERSON") return CrimeCategory.PERSONS;
    if (seg === "PROPERTY") best = CrimeCategory.PROPERTY;
  }
  return best;
}

// Title-case to match the City of Riverside's official community-boundary
// names (the NeighborhoodsRiverside `COMMUNITY`s). The feed already supplies
// well-cased labels (e.g. "Magnolia Center"); we normalize defensively and
// preserve Mc/Mac and O' prefixes.
function titleCaseCommunity(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bMc(\w)/g, (_, c) => "Mc" + c.toUpperCase())
    .replace(/\bMac([a-z])/g, (_, c) => "Mac" + c.toUpperCase())
    .replace(/\bO'(\w)/g, (_, c) => "O'" + c.toUpperCase())
    .replace(/\b(Of|And|The)\b/g, (w) => w.toLowerCase())
    .trim();
}

// Feed rows outside every community carry a null COMMUNITY; they're filtered
// out before mapping, so there is no catch-all bucket to exclude here.
const NON_COMMUNITY = new Set(["Unknown", ""]);

function slugifyCommunity(name: string): string {
  return `riv-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

const PROVENANCE: DataProvenance = {
  source: "Riverside Police Department (City of Riverside ArcGIS Open Data)",
  datasetUrl: "https://data-riversideca.opendata.arcgis.com/",
  recency: "Refreshed by the Riverside Police Department (rolling last-year-to-date NIBRS incident feed)",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Riverside Police Department and grouped by the city's " +
    "own community boundaries — not live, not street-level. CommunitySafe does not track individuals.",
};

function occurredAtFor(offenDateMs: number | undefined, hour: number | undefined): string {
  // offendate is an epoch-ms whose Los-Angeles wall clock already matches the
  // real incident time-of-day (verified against the hourofday field), so use
  // it directly. Only synthesize from hourofday if offendate is missing.
  if (typeof offenDateMs === "number") return new Date(offenDateMs).toISOString();
  if (typeof hour === "number") {
    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: RIVERSIDE_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const hh = String(Math.min(23, Math.max(0, hour))).padStart(2, "0");
    return cityLocalToUtcIso(`${ymd}T${hh}:00:00`, RIVERSIDE_TZ);
  }
  return cityLocalToUtcIso(null, RIVERSIDE_TZ);
}

async function fetchPage(offset: number, sinceTs: string): Promise<RiversideFeature[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", `offendate >= timestamp '${sinceTs}'`);
  url.searchParams.set("outFields", "ObjectID,offendate,hourofday,nibrsdesc,nibrscode,IBRCrimeAgainst,COMMUNITY,rd,BLOCK_ADDRESS");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("orderByFields", "offendate DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Riverside ArcGIS ${res.status} offset=${offset}`);
  const body = (await readJson(res)) as { features?: RiversideFeature[]; error?: unknown };
  // Throw on the embedded ArcGIS error envelope (HTTP 200 + {error:{...}}) so a
  // token-gated/failed layer serves last-known-good instead of grading as zero-crime.
  if (body.error) throw new Error(`Riverside ArcGIS body error offset=${offset}`);
  return body.features ?? [];
}

async function fetchRiverside(): Promise<Incident[]> {
  const sinceTs = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  const results: RiversideFeature[][] = new Array(PAGES);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PAGES) return;
      results[i] = await fetchPage(i * PAGE_SIZE, sinceTs).catch(() => [] as RiversideFeature[]);
    }
  });
  await Promise.all(workers);
  const feats = results.flat();
  return feats
    .filter((f) => typeof f.attributes.offendate === "number" && (f.attributes.COMMUNITY ?? "").trim())
    .map((f, i) => {
      const a = f.attributes;
      const lng = f.geometry && f.geometry.x !== 0 ? f.geometry.x : undefined;
      const lat = f.geometry && f.geometry.y !== 0 ? f.geometry.y : undefined;
      return {
        id: `riv-${a.ObjectID ?? a.rpdunique ?? i}`,
        area: titleCaseCommunity((a.COMMUNITY ?? "").trim()),
        occurredAt: occurredAtFor(a.offendate, a.hourofday),
        nibrsCategory: classify(a.nibrsdesc, a.IBRCrimeAgainst),
        ibrOffenseDescription: titleCaseOffense(a.nibrsdesc ?? "Unknown"),
        beat: a.rd ?? null,
        blockLabel: a.BLOCK_ADDRESS ?? undefined,
        lat,
        lng,
      } as Incident;
    });
}

// In-flight fetch dedup: the dispatcher fans a per-area Promise.all over every
// community, so a cold cache would otherwise fire N concurrent full fetches.
let inFlightFetch: Promise<Incident[]> | null = null;
export async function getRowsRiverside(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightFetch) return inFlightFetch;
  inFlightFetch = (async () => {
    try {
      const rows = await fetchRiverside();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[riverside] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightFetch = null;
    }
  })();
  return inFlightFetch;
}

export async function getDiscoveredAreasRiverside(): Promise<KnownArea[]> {
  const rows = await getRowsRiverside();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || NON_COMMUNITY.has(r.area)) continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat;
    e.lngSum += r.lng;
    e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 3)
    .map(([name, e]) => ({
      slug: slugifyCommunity(name),
      label: name,
      jurisdiction: "Riverside",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForSlug(slug: string, rows: Incident[]): string | null {
  const want = slug.toLowerCase();
  for (const r of rows) {
    if (slugifyCommunity(r.area) === want) return r.area;
  }
  return null;
}

export const riversideAdapter: CrimeDataAdapter = {
  name: "riverside-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsRiverside();
    const label = labelForSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [40, 120, 250, 500]);
    return {
      area: label,
      crimeRate: null,
      violentCrimeRate: null,
      propertyCrimeRate: null,
      riskLevel,
      provenance: PROVENANCE,
    };
  },
  async getIncidents(area, opts) {
    const rows = await getRowsRiverside();
    const label = labelForSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area, opts) {
    return this.getIncidents(area, { limit: opts?.limit ?? 20 });
  },
};
