import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT, readJson, fetchWithRetry } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";

// Savannah, GA — Savannah Police Department public NIBRS incident feed
// (City of Savannah ArcGIS Online, services3/0m9qmmEbiydeqFeD). Incident-level
// rows with point geometry, a NIBRS code/description (`nibrsdesc`), a friendly
// NIBRS crime-against bucket (`nibrscrimeag` = Violent Crime / Property Crime /
// Other), an occurrence date-time (`occurfrdate`, epoch ms whose wall-clock is
// Eastern local time stored as UTC), and — like the Dayton feed — the city's
// own neighborhood name (`neighborhood`, ~135 official SPD neighborhoods). We
// take the neighborhood straight from the feed — no point-in-polygon needed.
//
// IMPORTANT — DATA LAG: this is a rolling but LAGGED feed. As of 2026-06-20 the
// newest `occurfrdate` is 2026-03-29 (~83 days old). The provenance below says
// so honestly. To still grade on a full year of data we widen the where-window
// to 500 days (the score's 365-day window then sits comfortably inside the
// freshest year of available rows).
// Source: https://services3.arcgis.com/0m9qmmEbiydeqFeD/arcgis/rest/services/Crimes_public_40f32d2b807f468cb793a907ba14e44c/FeatureServer/0

const BASE =
  "https://services3.arcgis.com/0m9qmmEbiydeqFeD/arcgis/rest/services/Crimes_public_40f32d2b807f468cb793a907ba14e44c/FeatureServer/0/query";
const SAVANNAH_TZ = "America/New_York";
const PAGE_SIZE = 2000; // = server maxRecordCount
// Feed is lagged ~3 months; widen the window to 500 days so the 365-day score
// window is fully covered by the freshest year of available rows.
const WINDOW_DAYS = 500;
const PAGES = 6; // ~7.2k rows/500d observed → 6 pages (12k) has comfortable headroom
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => {
  cache = null;
}, "savannah-arcgis");

interface SavannahFeature {
  attributes: {
    OBJECTID?: number;
    offenseid?: string;
    nibrscode?: string;
    nibrsdesc?: string; // e.g. "Robbery - Street - Gun" (nullable)
    nibrscrimeag?: string; // "Violent Crime" | "Property Crime" | "Other" (nullable)
    neighborhood?: string; // official SPD neighborhood name
    beat?: string;
    district?: string;
    occurfrdate?: number; // epoch ms; wall-clock is Eastern local stored as UTC
    reporthour?: number;
  };
  geometry?: { x: number; y: number }; // x=lng, y=lat (WGS84 when outSR=4326)
}

// NIBRS offense description → CommunitySafe bucket (Crimes Against Persons /
// Property / Society). We classify on the detailed `nibrsdesc` first, falling
// back to the coarse `nibrscrimeag` bucket when the description is null (~1.3%
// of rows). Robbery is filed by NIBRS under Property but the FBI UCR counts it
// as a Part-1 VIOLENT offense, so we force it to PERSONS (same convention as
// the Long Beach / Dallas / Saint Paul adapters).
function classify(desc: string | undefined, crimeAgainst: string | undefined): CrimeCategory {
  const d = (desc ?? "").toUpperCase();
  if (d.includes("ROBBERY")) return CrimeCategory.PERSONS;
  if (
    d.includes("ASSAULT") ||
    d.includes("HOMICIDE") ||
    d.includes("MURDER") ||
    d.includes("MANSLAUGHTER") ||
    d.includes("RAPE") ||
    d.includes("KIDNAP") ||
    d.includes("ABDUCTION") ||
    d.includes("SEX") ||
    d.includes("HUMAN TRAFFICKING")
  ) {
    return CrimeCategory.PERSONS;
  }
  if (
    d.includes("BURGLARY") ||
    d.includes("LARCENY") ||
    d.includes("THEFT") ||
    d.includes("AUTO") || // "Auto Theft - Auto"
    d.includes("MOTOR VEHICLE") ||
    d.includes("ARSON") ||
    d.includes("VANDALISM") ||
    d.includes("DAMAGE") ||
    d.includes("DESTRUCTION") ||
    d.includes("FRAUD") ||
    d.includes("FORGERY") ||
    d.includes("COUNTERFEIT") ||
    d.includes("EMBEZZLEMENT") ||
    d.includes("EXTORTION") ||
    d.includes("STOLEN PROPERTY")
  ) {
    return CrimeCategory.PROPERTY;
  }
  // Fall back to the coarse crime-against bucket when nibrsdesc is null/unknown.
  const ca = (crimeAgainst ?? "").toUpperCase();
  if (ca.includes("VIOLENT")) return CrimeCategory.PERSONS;
  if (ca.includes("PROPERTY")) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// Title-case to match the City of Savannah's official neighborhood-boundary
// names, preserving Mc/Mac and O' prefixes. The feed labels are already
// mixed-case (e.g. "NW Historic District", "Cuyler/Brownsville") so we
// normalize gently and keep all-caps directional prefixes (NW/SE/MLK/HAAF).
const KEEP_UPPER = new Set(["NW", "NE", "SW", "SE", "MLK", "HAAF", "US", "SPA", "E", "W", "N", "S"]);
function titleCaseNeighborhood(name: string): string {
  return name
    .trim()
    .split(/(\s|\/|-)/)
    .map((tok) => {
      if (tok === " " || tok === "/" || tok === "-") return tok;
      const up = tok.toUpperCase();
      if (KEEP_UPPER.has(up)) return up;
      const lower = tok.toLowerCase();
      let out = lower.replace(/^\w/, (c) => c.toUpperCase());
      out = out
        .replace(/^Mc(\w)/, (_, c) => "Mc" + c.toUpperCase())
        .replace(/^Mac([a-z])/, (_, c) => "Mac" + c.toUpperCase())
        .replace(/^O'(\w)/, (_, c) => "O'" + c.toUpperCase());
      return out;
    })
    .join("")
    .replace(/\b(Of|And|The)\b/g, (w) => w.toLowerCase())
    .trim();
}

// Feed catch-all bucket for points outside every neighborhood — counts
// citywide but is not a browsable neighborhood, so it's excluded from discovery.
const NON_NEIGHBORHOOD = new Set(["Other", "Unknown", ""]);

function slugifyNeighborhood(name: string): string {
  return `sav-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

const PROVENANCE: DataProvenance = {
  source: "Savannah Police Department (City of Savannah ArcGIS Open Data)",
  datasetUrl:
    "https://services3.arcgis.com/0m9qmmEbiydeqFeD/arcgis/rest/services/Crimes_public_40f32d2b807f468cb793a907ba14e44c/FeatureServer/0",
  recency:
    "Published by the Savannah Police Department on a lagged schedule — the most " +
    "recent incidents are typically a few months old (data through late March 2026 " +
    "as of mid-2026). CommunitySafe grades on the freshest available 12 months.",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Savannah Police Department and grouped by the city's " +
    "own neighborhood boundaries — not live, not street-level, and published with a lag. " +
    "CommunitySafe does not track individuals.",
};

// `occurfrdate` is an epoch-ms whose wall-clock fields (read as UTC) are the
// Eastern local time of the incident. We extract those Y-M-D-H-M parts in UTC,
// then re-interpret them as America/New_York wall-clock via cityLocalToUtcIso
// so the canonical UTC instant is DST-correct. The feed's `reporthour` is the
// REPORT hour (not the occurrence hour) so we do NOT use it — occurfrdate
// already carries the real occurrence time-of-day.
function occurredAtFor(occurMs: number | undefined): string {
  if (typeof occurMs !== "number") return cityLocalToUtcIso(null, SAVANNAH_TZ);
  const d = new Date(occurMs);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const wall =
    `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}` +
    `T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
  return cityLocalToUtcIso(wall, SAVANNAH_TZ);
}

async function fetchPage(offset: number, sinceTs: string): Promise<SavannahFeature[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", `occurfrdate >= timestamp '${sinceTs}'`);
  url.searchParams.set(
    "outFields",
    "OBJECTID,offenseid,nibrscode,nibrsdesc,nibrscrimeag,neighborhood,beat,district,occurfrdate",
  );
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("orderByFields", "occurfrdate DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Savannah ArcGIS ${res.status} offset=${offset}`);
  const body = (await readJson(res)) as { features?: SavannahFeature[]; error?: unknown };
  // Throw on the embedded ArcGIS error envelope (HTTP 200 + {error:{...}}) so a
  // token-gated/failed layer serves last-known-good instead of grading as zero-crime.
  if (body.error) throw new Error(`Savannah ArcGIS body error offset=${offset}`);
  return body.features ?? [];
}

async function fetchSavannah(): Promise<Incident[]> {
  const sinceTs = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  const results: SavannahFeature[][] = new Array(PAGES);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PAGES) return;
      results[i] = await fetchPage(i * PAGE_SIZE, sinceTs).catch(() => [] as SavannahFeature[]);
    }
  });
  await Promise.all(workers);
  const feats = results.flat();
  return feats
    .filter((f) => typeof f.attributes.occurfrdate === "number" && (f.attributes.neighborhood ?? "").trim())
    .map((f, i) => {
      const a = f.attributes;
      const lng = f.geometry && f.geometry.x !== 0 ? f.geometry.x : undefined;
      const lat = f.geometry && f.geometry.y !== 0 ? f.geometry.y : undefined;
      return {
        id: `sav-${a.OBJECTID ?? a.offenseid ?? i}`,
        area: titleCaseNeighborhood((a.neighborhood ?? "").trim()),
        occurredAt: occurredAtFor(a.occurfrdate),
        nibrsCategory: classify(a.nibrsdesc, a.nibrscrimeag),
        ibrOffenseDescription: titleCaseOffense(a.nibrsdesc ?? a.nibrscrimeag ?? "Unknown"),
        beat: a.beat ?? null,
        blockLabel: undefined,
        lat,
        lng,
      } as Incident;
    });
}

// In-flight fetch dedup: the dispatcher fans a per-area Promise.all over every
// neighbourhood, so a cold cache would otherwise fire N concurrent full fetches.
let inFlightFetch: Promise<Incident[]> | null = null;
export async function getRowsSavannah(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightFetch) return inFlightFetch;
  inFlightFetch = (async () => {
    try {
      const rows = await fetchSavannah();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[savannah] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightFetch = null;
    }
  })();
  return inFlightFetch;
}

export async function getDiscoveredAreasSavannah(): Promise<KnownArea[]> {
  const rows = await getRowsSavannah();
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
      jurisdiction: "Savannah",
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

export const savannahAdapter: CrimeDataAdapter = {
  name: "savannah-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsSavannah();
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
    const rows = await getRowsSavannah();
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
