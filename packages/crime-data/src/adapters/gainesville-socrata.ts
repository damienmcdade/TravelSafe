import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { fetchSocrata } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";
import { gainesvillePolygons } from "../data/gainesville-neighborhoods.js";

// Gainesville, FL — GPD "Crime Responses" (Socrata gvua-xt9q on
// data.cityofgainesville.org). Keyless Socrata dataset, ~230k rows
// fresh to within a few days, one row per offense response. Each row
// carries a FREE-TEXT `narrative` (e.g. "Theft Petit - Retail",
// "Robbery (armed)", "Drug Violation") that we keyword-classify into
// the NIBRS PERSONS / PROPERTY / SOCIETY buckets (same free-text
// approach as the Kansas City adapter), plus block-fuzzed latitude /
// longitude.
//
// The feed has NO neighborhood/area field, so we point-in-polygon each
// incident's lat/lng into one of 114 real, recognizable Gainesville
// neighborhoods (City of Gainesville planning department "GNV Neighborhoods"
// open-data layer — Duckpond, Pleasant Street, Sugarfoot, Porters,
// University Park, Highland Court Manor, Stephen Foster, …) — the same
// in-repo polygon set that powers apps/web/public/geo/gainesville.geojson.
// Points outside every neighborhood or with no coordinates fall into
// "Unmapped" so they still count citywide (mirrors the Kansas City fallback).
// Source: https://data.cityofgainesville.org/resource/gvua-xt9q.json

const BASE = "https://data.cityofgainesville.org/resource/gvua-xt9q.json";
const TZ = "America/New_York";
// Socrata's $limit hard-caps at 50k per request. The dataset is large
// (~230k all-time) so we bound the pull to a recent window — wide
// enough to clear safety-score's 30-day low-confidence trip-wire and
// give the per-zone quintile bands a stable distribution.
const ROW_LIMIT = 50_000;
const WINDOW_DAYS = 365;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; }, "gainesville-socrata");

interface GnvRow {
  id?: string;
  narrative?: string;
  offense_date?: string;
  offense_hour_of_day?: string;
  latitude?: string;
  longitude?: string;
  address?: string;
  location?: { type: "Point"; coordinates: [number, number] };
}

// ---- Free-text narrative → NIBRS classify -------------------------------
// Same keyword-bucketing approach as kansas-city-socrata.ts. ROBBERY is
// checked first so it lands in PERSONS (FBI UCR Part-1 VIOLENT) instead of
// being swept into PROPERTY by "THEFT"-adjacent keys.
const PERSONS_KEYS = [
  // ROBBERY first — FBI UCR Part-1 VIOLENT (force/threat against a person);
  // GPD files "Robbery (armed)" / "Robbery (strong arm)". Same robbery
  // reclassification as the KC / Dallas / Long Beach adapters.
  "ROBBERY",
  "ASSAULT", "BATTERY", "HOMICIDE", "MURDER", "MANSLAUGHTER",
  "KIDNAP", "ABDUCT", "RAPE", "SEX OFFENSE", "SEX BATTERY", "MOLEST",
  "DATING VIOLENCE", "DOMESTIC", "STALKING", "STRANGULATION",
  "HARASS", "INTIMIDAT", "THREAT",
];
const PROPERTY_KEYS = [
  "THEFT", "STOLEN", "STEAL", "BURGLARY", "LARCENY", "SHOPLIFT",
  "CRIMINAL MISCHIEF", "DAMAGE TO PROPERTY", "DAMAGE TO CITY PROPERTY",
  "VANDAL", "ARSON", "FORGERY", "FRAUD", "COUNTERFEIT", "EMBEZZLE",
  "IDENTITY THEFT", "STOLEN VEHICLE", "VEHICLE TAG",
];
const SOCIETY_KEYS = [
  "DRUG", "NARCOTIC", "POSSESSION", "PARAPHERNALIA", "CONTRABAND",
  "WEAPON", "FIREARM", "TRESPASS", "DISORDERLY", "DISTURBANCE",
  "DUI", "DRIVING UNDER THE INFLUENCE", "INTOX", "PROSTITUTION",
  "WARRANT", "RESIST", "OBSTRUCT", "VIOLATION", "LIQUOR", "ALCOHOL",
];
// Drop administrative / non-criminal narrative rows at ingest so they
// never inflate the citywide or per-zone counts.
const SKIP_KEYS = [
  "INFORMATION", "SUSPICIOUS INCIDENT", "LOST PROPERTY", "FOUND PROPERTY",
  "ASSIST OTHER AGENCY", "ASSIST CITIZEN", "SICK / INJURED", "DEATH INVESTIGATION",
  "DCF INVESTIGATIONS", "BAKER ACT", "MISSING PERSON", "RUNAWAY",
  "JUVENILE PROBLEM", "DAMAGE TO PROPERTY (NON",
];

function classify(narrative: string): CrimeCategory | null {
  const t = narrative.toUpperCase();
  for (const k of SKIP_KEYS) if (t.includes(k)) return null;
  if (PERSONS_KEYS.some((k) => t.includes(k))) return CrimeCategory.PERSONS;
  if (PROPERTY_KEYS.some((k) => t.includes(k))) return CrimeCategory.PROPERTY;
  if (SOCIETY_KEYS.some((k) => t.includes(k))) return CrimeCategory.SOCIETY;
  return null;
}

// ---- Point-in-polygon over the named Gainesville neighborhoods ----------
// bbox-prefiltered ray casting — same self-contained pattern as the
// Long Beach / Kansas City / Boston adapters.
interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = gainesvillePolygons.map((p) => {
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
function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function geocodeGainesville(lng: number, lat: number): string | null {
  for (const p of POLY_INDEX) {
    const [minX, minY, maxX, maxY] = p.bbox;
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
    let parity = 0;
    for (const ring of p.rings) if (pointInRing(lng, lat, ring)) parity++;
    if (parity % 2 === 1) return p.name;
  }
  return null;
}

const PROVENANCE: DataProvenance = {
  source: "Gainesville Police Department Crime Responses (City of Gainesville Open Data, Socrata)",
  datasetUrl: "https://data.cityofgainesville.org/Public-Safety/Crime-Responses/gvua-xt9q",
  recency: "Refreshed routinely by the Gainesville Police Department (recent ~12-month window)",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Gainesville Police Department and geocoded to one of " +
    "Gainesville's named neighborhoods (City planning department \"GNV Neighborhoods\" layer) " +
    "— not live, not street-level. Coordinates are block-fuzzed by GPD; points outside every " +
    "neighborhood are bucketed as \"Unmapped\" but still count citywide. " +
    "CommunitySafe does not track individuals.",
};

async function fetchGainesville(): Promise<Incident[]> {
  const rows = await fetchSocrata<GnvRow>("Gainesville GPD", {
    url: BASE,
    select: "id,narrative,offense_date,offense_hour_of_day,latitude,longitude,address,location",
    where: "location IS NOT NULL",
    windowDays: WINDOW_DAYS,
    dateField: "offense_date",
    order: "offense_date DESC",
    limit: ROW_LIMIT,
  });
  const out: Incident[] = [];
  for (const r of rows) {
    const desc = r.narrative?.trim() ?? "";
    const cat = classify(desc);
    if (cat == null) continue;
    // offense_date is a wall-clock ET floating timestamp — route it
    // through cityLocalToUtcIso so the hour-of-day histogram buckets by
    // Gainesville's local clock, not the UTC runtime.
    const occurredAt = cityLocalToUtcIso(r.offense_date, TZ);
    if (+new Date(occurredAt) <= 0) continue; // drop unparseable dates
    const coords = r.location?.coordinates;
    let lng = coords ? Number(coords[0]) : Number(r.longitude);
    let lat = coords ? Number(coords[1]) : Number(r.latitude);
    if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) { lat = NaN; lng = NaN; }
    const area = (!isNaN(lat) && !isNaN(lng))
      ? (geocodeGainesville(lng, lat) ?? "Unmapped")
      : "Unmapped";
    out.push({
      id: `gnv-${r.id ?? out.length}`,
      area,
      occurredAt,
      nibrsCategory: cat,
      ibrOffenseDescription: titleCaseOffense(desc),
      beat: null,
      blockLabel: r.address ?? undefined,
      lat: !isNaN(lat) ? lat : undefined,
      lng: !isNaN(lng) ? lng : undefined,
    });
  }
  return out;
}

export async function getRowsGainesville(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchGainesville();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[gainesville] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasGainesville(): Promise<KnownArea[]> {
  const rows = await getRowsGainesville();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown" || r.area === "Unmapped") continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat; e.lngSum += r.lng; e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 3)
    .map(([name, e]) => ({
      slug: `gnv-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Gainesville",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForGainesvilleSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("gnv-") ? s.slice(4) : s;
  for (const r of rows) {
    const cand = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (cand === want) return r.area;
  }
  return null;
}

export const gainesvilleAdapter: CrimeDataAdapter = {
  name: "gainesville-socrata",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsGainesville();
    const label = labelForGainesvilleSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    // Self-calibrating quintile bands over Gainesville's own per-neighborhood
    // distribution (114 neighborhoods → quintiles always apply); degrades to
    // these neighborhood-scale thresholds only for a thin/flat distribution.
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [40, 120, 300, 700]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },
  async getIncidents(area, opts) {
    const rows = await getRowsGainesville();
    const label = labelForGainesvilleSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area, opts) { return this.getIncidents(area, { limit: opts?.limit ?? 20 }); },
};
