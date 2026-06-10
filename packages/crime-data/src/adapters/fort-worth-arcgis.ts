import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT, readJson } from "../lib/http.js";
import { createTieredLoader } from "../lib/tiered-loader.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";
import { fortWorthNeighborhoods, fortWorthDivisions } from "../data/fort-worth-neighborhoods.js";

// Fort Worth, TX — FWPD "Crime Data" ArcGIS MapServer (City of Fort Worth GIS).
// Incident-level rows with lat/lng. We geocode each incident by point-in-polygon
// into one of 384 official Fort Worth NEIGHBORHOOD-association areas (real names
// like "Fairmount", "Berkeley Place", "Ryan Place"); the registered associations
// don't tile the whole city, so incidents outside every neighborhood fall back
// to the named FWPD patrol DIVISION they sit in (North/South/East/West/Central/
// Northwest) rather than a meaningless beat code. Offenses are Texas Penal Code
// text, mapped to FBI Part-1 violent/property by the penal-code section (far more
// reliable than free-text keywords for the simple-vs-aggravated-assault split).
// Refreshed continuously (newest rows current).
// Source: https://mapit.fortworthtexas.gov/ags/rest/services/CIVIC/Crime_Data/MapServer/0

const BASE = "https://mapit.fortworthtexas.gov/ags/rest/services/CIVIC/Crime_Data/MapServer/0/query";
const PAGE_SIZE = 1000; // = server maxRecordCount
// All-history MapServer; pull a rolling ~9-month window for an accurate
// annualized rate. ~60k rows/yr ÷ 1000 ≈ 60 pages/yr; 45 pages (~270 days)
// is a statistically solid window the annualizer scales up.
const PAGES = 45;
// v108 — tiered cold load (see lib/tiered-loader): serve the most-recent
// RECENT_PAGES fast, backfill the rest in the background.
const RECENT_PAGES = 8;
const WINDOW_DAYS = 270;

interface FwFeature {
  attributes: {
    Case_No_Offense?: string;
    Reported_Date?: number;   // epoch ms
    Offense?: string | number;
    Offense_Desc?: string;    // Texas Penal Code text, e.g. "PC 30.04(A) Burglary Vehicle"
    Beat?: string;
    Division?: string;
    Latitude?: number;
    Longitude?: number;
  };
}

// Map a Texas Penal Code section → FBI Part-1 category. We key off the PC
// section number (parsed from Offense_Desc) because it cleanly separates the
// Part-1 offenses (esp. agg-assault 22.02 vs simple-assault 22.01, which
// free-text "ASSAULT" can't). Non-PC rows (Government/Transportation Code,
// city ordinances) fall through to SOCIETY.
function classify(desc: string | undefined): CrimeCategory {
  const text = desc ?? "";
  const m = /\bPC\s+(\d+)\.(\d+)/i.exec(text);
  if (m) {
    const code = `${m[1]}.${m[2]}`;
    // VIOLENT (Part-1 persons)
    if (/^19\.(02|03)$/.test(code)) return CrimeCategory.PERSONS;          // murder / capital murder
    if (code === "22.02") return CrimeCategory.PERSONS;                    // aggravated assault
    if (/^(22\.011|22\.021|21\.02|21\.11)$/.test(code)) return CrimeCategory.PERSONS; // sexual assault / indecency-rape
    if (/^29\.(02|03)$/.test(code)) return CrimeCategory.PERSONS;          // robbery / aggravated robbery
    // PROPERTY (Part-1)
    if (code === "28.02") return CrimeCategory.PROPERTY;                   // arson
    if (/^30\.(02|04)$/.test(code)) return CrimeCategory.PROPERTY;         // burglary / burglary of vehicle
    if (/^31\.(03|04|05|07|11)$/.test(code)) return CrimeCategory.PROPERTY; // theft / unauthorized use of vehicle
    return CrimeCategory.SOCIETY;                                          // incl. 22.01 simple assault, 30.05 trespass, etc.
  }
  // Keyword fallback for the rare row without a parseable PC section.
  const d = text.toUpperCase();
  if (/ROBBERY|MURDER|HOMICIDE|CAPITAL|AGG[^A-Z]{0,4}ASSAULT|AGGRAVATED ASSAULT|SEXUAL ASSAULT|\bRAPE\b/.test(d)) return CrimeCategory.PERSONS;
  if (/BURGLARY|\bTHEFT\b|LARCENY|ARSON|STOLEN/.test(d)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// Point-in-polygon geocoder: 384 neighborhood-association polygons (primary) +
// 6 FWPD division polygons (fallback that covers the whole city). bbox-prefiltered
// ray casting with even-odd parity — same self-contained pattern as Long Beach /
// Boston / Indianapolis.
interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
function buildIndex(polys: { name: string; geometry: { type: string; coordinates: unknown } }[]): PolyIndex[] {
  return polys.map((p) => {
    const rings: number[][][] = p.geometry.type === "Polygon"
      ? (p.geometry.coordinates as number[][][])
      : (p.geometry.coordinates as number[][][][]).flat();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ring of rings) for (const [x, y] of ring) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { name: p.name, bbox: [minX, minY, maxX, maxY], rings };
  });
}
const NBHD_INDEX: PolyIndex[] = buildIndex(fortWorthNeighborhoods);
const DIV_INDEX: PolyIndex[] = buildIndex(fortWorthDivisions);
function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function inPolys(lng: number, lat: number, index: PolyIndex[]): string | null {
  for (const p of index) {
    const [minX, minY, maxX, maxY] = p.bbox;
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
    let parity = 0;
    for (const ring of p.rings) if (pointInRing(lng, lat, ring)) parity++;
    if (parity % 2 === 1) return p.name;
  }
  return null;
}
function geocodeFortWorth(lng: number, lat: number): string | null {
  return inPolys(lng, lat, NBHD_INDEX) ?? inPolys(lng, lat, DIV_INDEX);
}

const PROVENANCE: DataProvenance = {
  source: "Fort Worth Police Department Crime Data (City of Fort Worth GIS)",
  datasetUrl: "https://data.fortworthtexas.gov/",
  recency: "Refreshed continuously by the Fort Worth Police Department",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Fort Worth Police Department and geocoded to one of " +
    "384 official Fort Worth neighborhoods (FWPD patrol division for the areas registered " +
    "associations don't cover) — not live, not street-level. CommunitySafe does not track individuals.",
};

async function fetchPage(offset: number, sinceIso: string): Promise<FwFeature[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", `Reported_Date >= DATE '${sinceIso}'`);
  url.searchParams.set("outFields", "Case_No_Offense,Reported_Date,Offense,Offense_Desc,Beat,Division,Latitude,Longitude");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "Reported_Date DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("f", "json");
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`Fort Worth ArcGIS ${res.status} offset=${offset}`);
  const body = await readJson(res) as { features?: FwFeature[]; error?: { message?: string } };
  if (body.error) throw new Error(`Fort Worth ArcGIS error: ${body.error.message}`);
  return body.features ?? [];
}

function mapFortWorth(feats: FwFeature[], baseIndex: number): Incident[] {
  // v108 audit — map over the UNFILTERED page so `i` is the raw page-relative
  // index (stable + unique `idx` fallback ids across tiers), then drop nulls.
  return feats
    .map((f, i): Incident | null => {
      if (typeof f.attributes.Reported_Date !== "number") return null;
      const a = f.attributes;
      const lat = typeof a.Latitude === "number" && Math.abs(a.Latitude) > 1 ? a.Latitude : undefined;
      const lng = typeof a.Longitude === "number" && Math.abs(a.Longitude) > 1 ? a.Longitude : undefined;
      const area = (lat != null && lng != null) ? (geocodeFortWorth(lng, lat) ?? "Unknown") : "Unknown";
      return {
        id: `fw-${a.Case_No_Offense ?? `idx${baseIndex + i}`}`,
        area,
        occurredAt: new Date(a.Reported_Date!).toISOString(),
        nibrsCategory: classify(a.Offense_Desc),
        ibrOffenseDescription: titleCaseOffense((a.Offense_Desc ?? "Unknown").replace(/^[A-Z]{2}\s+[\d.()A-Za-z]+\s*/, "").trim() || a.Offense_Desc || "Unknown"),
        beat: a.Beat ?? null,
        blockLabel: undefined,
        lat,
        lng,
      };
    })
    .filter((x): x is Incident => x !== null);
}

// Fetch the half-open page range [startPage, endPage) with bounded concurrency
// (4). A page failure degrades to [] and marks the range incomplete; an empty
// page short-circuits the worker (ran past the WINDOW_DAYS window).
async function fetchRangeFortWorth(startPage: number, endPage: number): Promise<{ rows: Incident[]; complete: boolean }> {
  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const count = endPage - startPage;
  const results: FwFeature[][] = new Array(count);
  let cursor = 0;
  let failures = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= count) return;
      const page = await fetchPage((startPage + i) * PAGE_SIZE, sinceIso).catch(() => { failures++; return [] as FwFeature[]; });
      results[i] = page;
      if (page.length === 0) return; // ran past the window
    }
  });
  await Promise.all(workers);
  return { rows: mapFortWorth(results.flat(), startPage * PAGE_SIZE), complete: failures === 0 };
}

const fortWorthLoader = createTieredLoader({
  name: "fort-worth-arcgis",
  recentPages: RECENT_PAGES,
  pages: PAGES,
  fetchRange: fetchRangeFortWorth,
});
export async function getRowsFortWorth(): Promise<Incident[]> {
  return fortWorthLoader.getRows();
}

function slugify(area: string): string {
  return `fw-${area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export async function getDiscoveredAreasFortWorth(): Promise<KnownArea[]> {
  const rows = await getRowsFortWorth();
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
    .map(([area, e]) => ({
      slug: slugify(area),
      label: area,
      jurisdiction: "Fort Worth",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

function labelForFortWorthSlug(slug: string, rows: Incident[]): string | null {
  const want = slug.toLowerCase();
  for (const r of rows) {
    if (slugify(r.area) === want) return r.area;
  }
  return null;
}

export const fortWorthAdapter: CrimeDataAdapter = {
  isComplete: () => fortWorthLoader.complete(),
  name: "fort-worth-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsFortWorth();
    const label = labelForFortWorthSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [40, 120, 250, 500]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },
  async getIncidents(area, opts) {
    const rows = await getRowsFortWorth();
    const label = labelForFortWorthSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area, opts) { return this.getIncidents(area, { limit: opts?.limit ?? 20 }); },
};
