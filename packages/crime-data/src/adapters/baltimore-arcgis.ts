import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";

// Baltimore, MD — BPD "NIBRS Group A Crime Data" ArcGIS FeatureServer.
// Incident-level NIBRS rows with point geometry that ALREADY carry an
// official Baltimore Neighborhood name (283 of them), so no point-in-polygon
// is needed — we group by the feed's own `Neighborhood` field and derive
// each area's centroid from its incidents' coordinates. The feed is the city's
// live crime set (refreshed within days; newest rows current).
// Source: https://services1.arcgis.com/UWYHeuuJISiGmgXx/arcgis/rest/services/NIBRS_GroupA_Crime_Data/FeatureServer/0

const BASE = "https://services1.arcgis.com/UWYHeuuJISiGmgXx/arcgis/rest/services/NIBRS_GroupA_Crime_Data/FeatureServer/0/query";
const PAGE_SIZE = 2000; // = server maxRecordCount
// The feed holds all history; we pull a rolling ~13-month window (date-filtered)
// for an accurate annualized rate. ~50k Part-1 rows/yr ÷ 2000 ≈ 26 pages; 30
// pages (60k) covers a full year with headroom.
const PAGES = 30;
const WINDOW_DAYS = 400;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; });

interface BpdFeature {
  attributes: {
    CCNumber?: string;
    CrimeDateTime?: number; // epoch ms
    Description?: string;    // offense, e.g. "AGG. ASSAULT", "LARCENY", "ROBBERY - STREET"
    Neighborhood?: string;   // official Baltimore neighborhood name
    New_District?: string;   // BPD district (fallback)
    Post?: string | number;
  };
  geometry?: { x: number; y: number };
}

// Baltimore's Part-1 Description vocabulary:
//   VIOLENT (persons): HOMICIDE, RAPE, ROBBERY - *, AGG. ASSAULT, SHOOTING,
//                      COMMON ASSAULT (Maryland's term for simple/2nd-degree
//                      assault — counted as PERSONS but the safety score's
//                      isPart1Violent deny-list excludes it from violent via
//                      the /common assault/ pattern, same as SDPD "SIMPLE").
//   PROPERTY: LARCENY, LARCENY FROM AUTO, BURGLARY, AUTO THEFT, ARSON.
function classify(description: string | undefined): CrimeCategory {
  const d = (description ?? "").toUpperCase();
  if (/HOMICIDE|RAPE|ROBBERY|ASSAULT|SHOOTING/.test(d)) return CrimeCategory.PERSONS;
  if (/LARCENY|BURGLARY|AUTO THEFT|THEFT|ARSON/.test(d)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// BPD-district fallback label for the rare incident missing a Neighborhood
// (water, parks, city edges). Excluded from neighborhood discovery below —
// those incidents still count citywide.
function districtFallback(district: string | undefined): string {
  const d = (district ?? "").trim();
  if (!d) return "Unknown";
  const title = d.charAt(0).toUpperCase() + d.slice(1).toLowerCase();
  return `BPD ${title} District`;
}

const PROVENANCE: DataProvenance = {
  source: "Baltimore Police Department NIBRS Group A Crime Data (Open Baltimore)",
  datasetUrl: "https://data.baltimorecity.gov/",
  recency: "Refreshed regularly by the Baltimore Police Department (rolling history)",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Baltimore Police Department and grouped to one of " +
    "283 official Baltimore neighborhoods (BPD district for the rare incident without a " +
    "neighborhood) — not live, not street-level. CommunitySafe does not track individuals.",
};

async function fetchPage(offset: number, sinceIso: string): Promise<BpdFeature[]> {
  const url = new URL(BASE);
  // Hosted FeatureServer rejects raw-epoch date predicates; use the SQL
  // DATE literal form (verified against the live service).
  url.searchParams.set("where", `CrimeDateTime >= DATE '${sinceIso}'`);
  url.searchParams.set("outFields", "CCNumber,CrimeDateTime,Description,Neighborhood,New_District,Post");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("orderByFields", "CrimeDateTime DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Baltimore ArcGIS ${res.status} offset=${offset}`);
  const body = await res.json() as { features?: BpdFeature[]; error?: { message?: string } };
  if (body.error) throw new Error(`Baltimore ArcGIS error: ${body.error.message}`);
  return body.features ?? [];
}

async function fetchBaltimore(): Promise<Incident[]> {
  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const results: BpdFeature[][] = new Array(PAGES);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PAGES) return;
      const page = await fetchPage(i * PAGE_SIZE, sinceIso).catch(() => [] as BpdFeature[]);
      results[i] = page;
      // Short-circuit: an empty page means we've run past the window.
      if (page.length === 0) return;
    }
  });
  await Promise.all(workers);
  const feats = results.flat();
  return feats
    .filter((f) => typeof f.attributes.CrimeDateTime === "number")
    .map((f, i) => {
      const a = f.attributes;
      const lng = f.geometry && f.geometry.x !== 0 ? f.geometry.x : undefined;
      const lat = f.geometry && f.geometry.y !== 0 ? f.geometry.y : undefined;
      const nbhd = (a.Neighborhood ?? "").trim();
      const area = nbhd || districtFallback(a.New_District);
      return {
        id: `balt-${a.CCNumber ?? i}`,
        area,
        occurredAt: new Date(a.CrimeDateTime!).toISOString(),
        nibrsCategory: classify(a.Description),
        ibrOffenseDescription: titleCaseOffense(a.Description ?? "Unknown"),
        beat: a.Post != null ? String(a.Post) : null,
        blockLabel: undefined,
        lat,
        lng,
      };
    });
}

export async function getRowsBaltimore(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchBaltimore();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[baltimore] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

function slugify(name: string): string {
  return `balt-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export async function getDiscoveredAreasBaltimore(): Promise<KnownArea[]> {
  const rows = await getRowsBaltimore();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    if (/^BPD .* District$/.test(r.area)) continue; // district fallback isn't a browsable neighborhood
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat; e.lngSum += r.lng; e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 3)
    .map(([name, e]) => ({
      slug: slugify(name),
      label: name,
      jurisdiction: "Baltimore",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForBaltimoreSlug(slug: string, rows: Incident[]): string | null {
  const want = slug.toLowerCase();
  for (const r of rows) {
    if (slugify(r.area) === want) return r.area;
  }
  return null;
}

export const baltimoreAdapter: CrimeDataAdapter = {
  name: "baltimore-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsBaltimore();
    const label = labelForBaltimoreSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [60, 180, 400, 800]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },
  async getIncidents(area, opts) {
    const rows = await getRowsBaltimore();
    const label = labelForBaltimoreSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area, opts) { return this.getIncidents(area, { limit: opts?.limit ?? 20 }); },
};
