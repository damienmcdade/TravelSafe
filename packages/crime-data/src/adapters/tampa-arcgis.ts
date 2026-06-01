import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";

// Tampa, FL — Tampa Police Department "crimes_public_365days" ArcGIS
// FeatureServer (keyless, hosted on the official TPD_TampaGIS org). Each row
// is an incident-level Group A index offense (point geometry) carrying a
// pre-joined `neighborhood` name — TPD's published civic-association areas
// (e.g. "Old Seminole Heights", "Historic Ybor", "Davis Islands", "Hyde Park
// Spanishtown Creek") — so we bucket by that named field directly rather than
// running point-in-polygon. The companion boundary layer
// (apps/web/public/geo/tampa.geojson) is the City of Tampa "Neighborhoods"
// polygon set keyed on the same `AssocLabel`, so every emitted area binds to a
// shape on the Crime Map (100% of mapped rows match a polygon).
//
// SCOPE: this is a curated Part-1 / Group-A index-crime feed only — homicide,
// rape, robbery, aggravated assault, burglary, larceny/theft, MV theft. It does
// NOT include drug/weapon/disorderly ("society") offenses or simple assault, so
// every row classifies as PERSONS or PROPERTY (no SOCIETY) — matching the FBI
// violent+property index used for citywide scoring.
//
// DATE: `occurfrdate` is published as the offense date at TAMPA-LOCAL MIDNIGHT
// (epoch ms; 04:00Z in EDT, 05:00Z in EST), i.e. a date-only value with no
// usable time-of-day. `new Date(ms).toISOString()` yields the correct calendar
// date, but Tampa is registered in DATE_ONLY_CITY_SLUGS so the time-of-day
// histogram suppresses itself instead of showing a fake midnight spike. (A
// separate `reporthour` field exists but is the REPORT hour, not the offense
// hour, so we do not synthesize times from it.)
//
// Source: https://services1.arcgis.com/IbNXlmt2RVVRCZ6M/arcgis/rest/services/crimes_public_365days/FeatureServer/0
const BASE = "https://services1.arcgis.com/IbNXlmt2RVVRCZ6M/arcgis/rest/services/crimes_public_365days/FeatureServer/0/query";
const PAGE_SIZE = 2000; // = server maxRecordCount
// The whole feed is a rolling 365-day window (~5.5k rows). 8 pages × 2k = 16k
// caps it with wide headroom so we never truncate the busiest neighborhoods.
const PAGES = 8;
const WINDOW_DAYS = 365;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; }, "tampa-arcgis");

interface TpaRow {
  OBJECTID?: number;
  offenseid?: string;
  nibrscode?: string;       // NIBRS code, e.g. "120", "13A", "23F"
  nibrsdesc?: string;       // offense, e.g. "Robbery", "Aggravated Assault"
  nibrscrimeag?: string;    // "Crimes Against Persons" | "Crimes Against Property"
  neighborhood?: string | null; // pre-joined civic-association name
  occurfrdate?: number | null;  // epoch ms at Tampa-local midnight (date-only)
}

// Classify by the NIBRS code prefix (most reliable), then fall back to the
// crime-against category and finally the description. Robbery (120) is filed
// by NIBRS as a property crime but the FBI/UCR counts it as VIOLENT — match the
// Jacksonville adapter and bucket it under PERSONS. The feed carries no
// society/drug offenses, so everything resolves to PERSONS or PROPERTY.
function classify(row: TpaRow): CrimeCategory {
  const c = (row.nibrscode ?? "").toUpperCase();
  if (/^(09|10|11|13|36|64|120)/.test(c)) return CrimeCategory.PERSONS;
  if (/^(200|210|220|23|240|250|26|280|290)/.test(c)) return CrimeCategory.PROPERTY;
  const ag = (row.nibrscrimeag ?? "").toUpperCase();
  if (ag.includes("PERSON")) return CrimeCategory.PERSONS;
  if (ag.includes("PROPERTY")) return CrimeCategory.PROPERTY;
  const d = (row.nibrsdesc ?? "").toUpperCase();
  if (/HOMICIDE|MURDER|MANSLAUGHTER|RAPE|ASSAULT|ROBBERY|KIDNAP|SEX/.test(d)) return CrimeCategory.PERSONS;
  if (/THEFT|BURGLAR|LARCENY|MOTOR VEHICLE|ARSON|VANDAL/.test(d)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// Bucket a row's raw neighborhood into an area label. Blank / null → "Unmapped".
function neighborhoodArea(n: string | null | undefined): string {
  const v = (n ?? "").trim();
  if (!v) return "Unmapped";
  return v;
}

const TPA_CENTROID = { lat: 27.9506, lng: -82.4572 };

const PROVENANCE: DataProvenance = {
  source: "Tampa Police Department Crimes (last 365 days) · City of Tampa GIS (ArcGIS Feature Server)",
  datasetUrl: "https://services1.arcgis.com/IbNXlmt2RVVRCZ6M/arcgis/rest/services/crimes_public_365days/FeatureServer/0",
  recency: "Rolling 365-day window, refreshed by the Tampa Police Department",
  granularity: "neighborhood",
  disclaimer:
    "Index offenses (homicide, rape, robbery, aggravated assault, burglary, theft, " +
    "motor-vehicle theft) reported by the Tampa Police Department and grouped to the " +
    "incident's neighborhood (\"Unmapped\" for the rare row without one) — not live, not " +
    "street-level, and excludes drug/disorderly offenses. CommunitySafe does not track individuals.",
};

async function fetchPage(offset: number, sinceDate: string): Promise<TpaRow[]> {
  const url = new URL(BASE);
  // occurfrdate is an esri date field — it needs a DATE 'YYYY-MM-DD' literal
  // (verified against the live FeatureServer; raw-epoch predicates are rejected).
  url.searchParams.set("where", `occurfrdate >= DATE '${sinceDate}'`);
  url.searchParams.set("outFields", "OBJECTID,offenseid,nibrscode,nibrsdesc,nibrscrimeag,neighborhood,occurfrdate");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("orderByFields", "occurfrdate DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  if (!res.ok) {
    // High offsets page past the end of the window — ArcGIS answers 400/404
    // there; on a non-first page that's just end-of-data, not a failure.
    if (offset > 0 && (res.status === 404 || res.status === 400)) return [];
    throw new Error(`Tampa ArcGIS ${res.status} offset=${offset}`);
  }
  const body = await res.json() as {
    features?: Array<{ attributes: TpaRow; geometry?: { x: number; y: number } }>;
    error?: { code?: number; message?: string };
  };
  if (body.error) throw new Error(`Tampa ArcGIS error ${body.error.code}: ${body.error.message}`);
  return (body.features ?? []).map((f) => {
    const a = f.attributes;
    // Stash geometry onto the row via parallel fields the mapper reads below.
    (a as TpaRow & { _x?: number; _y?: number })._x = f.geometry?.x;
    (a as TpaRow & { _x?: number; _y?: number })._y = f.geometry?.y;
    return a;
  });
}

async function fetchTampa(): Promise<Incident[]> {
  const sinceDate = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const results: TpaRow[][] = new Array(PAGES);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PAGES) return;
      const page = await fetchPage(i * PAGE_SIZE, sinceDate).catch((err) => {
        console.warn(`[tampa] page offset=${i * PAGE_SIZE} failed: ${(err as Error).message}`);
        return [] as TpaRow[];
      });
      results[i] = page;
      if (page.length === 0) return; // empty page → past the window
    }
  });
  await Promise.all(workers);
  const rows = results.flat();
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as TpaRow & { _x?: number; _y?: number };
    const ts = r.occurfrdate;
    if (typeof ts !== "number") continue;
    const lng = r._x && r._x !== 0 ? r._x : undefined;
    const lat = r._y && r._y !== 0 ? r._y : undefined;
    out.push({
      id: `tpa-${r.offenseid ?? r.OBJECTID ?? i}`,
      area: neighborhoodArea(r.neighborhood),
      // occurfrdate is an absolute epoch instant (Tampa-local midnight) → the
      // calendar date is correct as-is; time-of-day is suppressed (date-only).
      occurredAt: new Date(ts).toISOString(),
      nibrsCategory: classify(r),
      ibrOffenseDescription: titleCaseOffense(r.nibrsdesc ?? "Unknown"),
      beat: null,
      blockLabel: undefined,
      lat,
      lng,
    });
  }
  return out;
}

export async function getRowsTampa(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchTampa();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[tampa] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

// Area label is the neighborhood name; slug = "tpa-<slugified-name>". The
// boundary geojson sets properties.name to the same label so the Crime Map's
// normName() compare lines up.
function slugify(name: string): string {
  return `tpa-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export async function getDiscoveredAreasTampa(): Promise<KnownArea[]> {
  const rows = await getRowsTampa();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || r.area === "Unmapped") continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    if (r.lat != null && r.lng != null) { e.latSum += r.lat; e.lngSum += r.lng; }
    e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 1)
    .map(([name, e]) => {
      // Centroid from the incident points; fall back to the citywide centroid
      // if a (rare) area's rows all lacked geometry.
      const withGeom = e.latSum !== 0 || e.lngSum !== 0;
      return {
        slug: slugify(name),
        label: name,
        jurisdiction: "Tampa",
        centroid: withGeom ? { lat: e.latSum / e.count, lng: e.lngSum / e.count } : { ...TPA_CENTROID },
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForTampaSlug(slug: string, rows: Incident[]): string | null {
  const want = slug.toLowerCase();
  for (const r of rows) {
    if (r.area === "Unmapped") continue;
    if (slugify(r.area) === want) return r.area;
  }
  return null;
}

export const tampaAdapter: CrimeDataAdapter = {
  name: "tampa-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsTampa();
    const label = labelForTampaSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [25, 70, 140, 250]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },
  async getIncidents(area, opts) {
    const rows = await getRowsTampa();
    const label = labelForTampaSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area, opts) { return this.getIncidents(area, { limit: opts?.limit ?? 20 }); },
};
