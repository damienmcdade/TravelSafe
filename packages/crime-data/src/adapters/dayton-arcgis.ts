import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT, readJson, fetchWithRetry } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";

// Dayton, OH — Dayton Police Department "Crimes Greater 2016" ArcGIS
// FeatureServer. Incident-level NIBRS rows with point geometry already in
// WGS84, a real NIBRS category (`NIBRSCat`), the city's own neighborhood name
// (`Nhood`, ~50 official neighborhoods), and an hour-of-day (`CT1_HOUR`)
// distinct from the calendar date (`Commit_Date`, epoch-ms midnight local). We
// take the neighborhood straight from the feed — no point-in-polygon needed.
// Source: https://services2.arcgis.com/3dDB2Kk6kuA2gIGw/arcgis/rest/services/Crimes_Greater2016/FeatureServer/0

const BASE =
  "https://services2.arcgis.com/3dDB2Kk6kuA2gIGw/arcgis/rest/services/Crimes_Greater2016/FeatureServer/0/query";
const DAYTON_TZ = "America/New_York";
const PAGE_SIZE = 2000; // = server maxRecordCount
const WINDOW_DAYS = 400; // a touch over a year so the 365d score window is fully covered
const PAGES = 12; // ~17k rows/400d observed → 12 pages (24k) has comfortable headroom
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => {
  cache = null;
}, "dayton-arcgis");

interface DaytonFeature {
  attributes: {
    OBJECTID?: number;
    Commit_Date?: number; // epoch ms, calendar date at local midnight
    CT1_HOUR?: number; // hour of day 0-23
    NIBRSCat?: string; // e.g. "ASSAULT OFFENSES" (may be comma-joined multi-offense)
    NIBRSCode?: string;
    Nhood?: string; // official Dayton neighborhood name
    District?: string;
    BEAT?: string;
    Address?: string;
  };
  geometry?: { x: number; y: number }; // x=lng, y=lat (WGS84 when outSR=4326)
}

// NIBRS category → CommunitySafe bucket. Crimes Against Persons / Property /
// Society. We scan EVERY comma-segment and let the most-severe win
// (PERSONS > PROPERTY > SOCIETY) so a multi-offense report that includes an
// assault is counted as violent. Robbery is filed by NIBRS under Property but
// the FBI UCR counts it as a Part-1 VIOLENT offense, so force it to PERSONS
// (same convention as the Long Beach / Dallas / Saint Paul adapters).
function classify(nibrsCat: string | undefined): CrimeCategory {
  const segments = (nibrsCat ?? "").toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
  let best: CrimeCategory = CrimeCategory.SOCIETY;
  for (const seg of segments) {
    if (seg.includes("ROBBERY")) return CrimeCategory.PERSONS;
    if (
      seg.includes("ASSAULT") ||
      seg.includes("HOMICIDE") ||
      seg.includes("MURDER") ||
      seg.includes("KIDNAPPING") ||
      seg.includes("ABDUCTION") ||
      seg.includes("SEX OFFENSE") ||
      seg.includes("HUMAN TRAFFICKING")
    ) {
      return CrimeCategory.PERSONS;
    }
    if (
      seg.includes("BURGLARY") ||
      seg.includes("LARCENY") ||
      seg.includes("THEFT") ||
      seg.includes("MOTOR VEHICLE") ||
      seg.includes("ARSON") ||
      seg.includes("VANDALISM") ||
      seg.includes("DESTRUCTION") ||
      seg.includes("FRAUD") ||
      seg.includes("FORGERY") ||
      seg.includes("COUNTERFEIT") ||
      seg.includes("EMBEZZLEMENT") ||
      seg.includes("EXTORTION") ||
      seg.includes("STOLEN PROPERTY")
    ) {
      best = CrimeCategory.PROPERTY;
    }
  }
  return best;
}

// Title-case to match the City of Dayton's official neighborhood-boundary
// names (the dayton.geojson `name`s), preserving Mc/Mac and O' prefixes so the
// map polygon for e.g. "McCook Field" / "MacFarlane" lights up.
function titleCaseNeighborhood(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bMc(\w)/g, (_, c) => "Mc" + c.toUpperCase())
    .replace(/\bMac([a-z])/g, (_, c) => "Mac" + c.toUpperCase())
    .replace(/\bO'(\w)/g, (_, c) => "O'" + c.toUpperCase())
    .replace(/\b(Of|And|The)\b/g, (w) => w.toLowerCase())
    .trim();
}

// Feed catch-all bucket for points outside every neighborhood — counts
// citywide but is not a browsable neighborhood, so it's excluded from discovery.
const NON_NEIGHBORHOOD = new Set(["Outside City", "Unknown", ""]);

function slugifyNeighborhood(name: string): string {
  return `day-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

const PROVENANCE: DataProvenance = {
  source: "Dayton Police Department (City of Dayton ArcGIS Open Data)",
  datasetUrl: "https://data.daytonohio.gov/",
  recency: "Refreshed daily by the Dayton Police Department (rolling NIBRS incident feed)",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Dayton Police Department and grouped by the city's " +
    "own neighborhood boundaries — not live, not street-level. CommunitySafe does not track individuals.",
};

function occurredAtFor(commitDateMs: number | undefined, hour: number | undefined): string {
  if (typeof commitDateMs !== "number") return cityLocalToUtcIso(null, DAYTON_TZ);
  // Commit_Date is the calendar date at local midnight; extract Y-M-D in Dayton
  // local time, attach CT1_HOUR, then convert the wall-clock back to UTC.
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: DAYTON_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(commitDateMs));
  const hh = String(Math.min(23, Math.max(0, hour ?? 0))).padStart(2, "0");
  return cityLocalToUtcIso(`${ymd}T${hh}:00:00`, DAYTON_TZ);
}

async function fetchPage(offset: number, sinceTs: string): Promise<DaytonFeature[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", `Commit_Date >= timestamp '${sinceTs}'`);
  url.searchParams.set("outFields", "OBJECTID,Commit_Date,CT1_HOUR,NIBRSCat,NIBRSCode,Nhood,District,BEAT,Address");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("orderByFields", "Commit_Date DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Dayton ArcGIS ${res.status} offset=${offset}`);
  const body = (await readJson(res)) as { features?: DaytonFeature[]; error?: unknown };
  // Throw on the embedded ArcGIS error envelope (HTTP 200 + {error:{...}}) so a
  // token-gated/failed layer serves last-known-good instead of grading as zero-crime.
  if (body.error) throw new Error(`Dayton ArcGIS body error offset=${offset}`);
  return body.features ?? [];
}

async function fetchDayton(): Promise<Incident[]> {
  const sinceTs = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  const results: DaytonFeature[][] = new Array(PAGES);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PAGES) return;
      results[i] = await fetchPage(i * PAGE_SIZE, sinceTs).catch(() => [] as DaytonFeature[]);
    }
  });
  await Promise.all(workers);
  const feats = results.flat();
  return feats
    .filter((f) => typeof f.attributes.Commit_Date === "number" && (f.attributes.Nhood ?? "").trim())
    .map((f, i) => {
      const a = f.attributes;
      const lng = f.geometry && f.geometry.x !== 0 ? f.geometry.x : undefined;
      const lat = f.geometry && f.geometry.y !== 0 ? f.geometry.y : undefined;
      return {
        id: `day-${a.OBJECTID ?? i}`,
        area: titleCaseNeighborhood((a.Nhood ?? "").trim()),
        occurredAt: occurredAtFor(a.Commit_Date, a.CT1_HOUR),
        nibrsCategory: classify(a.NIBRSCat),
        ibrOffenseDescription: titleCaseOffense(a.NIBRSCat?.split(",")[0] ?? "Unknown"),
        beat: a.BEAT ?? null,
        blockLabel: undefined,
        lat,
        lng,
      } as Incident;
    });
}

// In-flight fetch dedup: the dispatcher fans a per-area Promise.all over every
// neighbourhood, so a cold cache would otherwise fire N concurrent full fetches.
let inFlightFetch: Promise<Incident[]> | null = null;
export async function getRowsDayton(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightFetch) return inFlightFetch;
  inFlightFetch = (async () => {
    try {
      const rows = await fetchDayton();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[dayton] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightFetch = null;
    }
  })();
  return inFlightFetch;
}

export async function getDiscoveredAreasDayton(): Promise<KnownArea[]> {
  const rows = await getRowsDayton();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || NON_NEIGHBORHOOD.has(r.area)) continue;
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
      slug: slugifyNeighborhood(name),
      label: name,
      jurisdiction: "Dayton",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForSlug(slug: string, rows: Incident[]): string | null {
  const want = slug.toLowerCase();
  for (const r of rows) {
    if (slugifyNeighborhood(r.area) === want) return r.area;
  }
  return null;
}

export const daytonAdapter: CrimeDataAdapter = {
  name: "dayton-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsDayton();
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
    const rows = await getRowsDayton();
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
