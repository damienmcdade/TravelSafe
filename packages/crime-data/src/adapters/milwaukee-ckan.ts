import { CrimeCategory } from "../crime-category.js";
import { readJson } from "../lib/http.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";
import { registerRowCache } from "../cache-registry.js";
import type { KnownArea } from "../neighborhoods.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";

// Milwaukee WI — Milwaukee Police Department WIBR (Wisconsin Incident-
// Based Reporting) crime data on data.milwaukee.gov.
//
// UPSTREAM SCHEMA CHANGE (caught 2026-06-12): the city REPLACED the WIBR
// resource's contents. The old shape (~9.4k rows: ReportedDateTime, RoughX/
// RoughY state-plane coords, ZIP, per-offense boolean flags) became ~100k rows
// of NIBRS-style records: Incident_Date, Address_Latitude/Address_Longitude
// (WGS84), Offense_All (semicolon-separated NIBRS offense codes, e.g.
// "13B;13C"), Police_District, Location_All, Weapon_Used_All. The old parser
// found none of its fields, skipped every row, and Milwaukee silently graded
// N/A ("no recent reports") in production while the feed was actually fresh
// (newest incident 2 days old). This adapter now speaks the new schema; the
// state-plane converter below is retained only for its standalone test and as
// reference should the city revert.
//
// Rows are NOT ordered by incident date (_id order follows edit/load order),
// so pages are pulled sorted by Incident_Date desc until the scoring window
// is covered.

const MILWAUKEE_RESOURCE_ID = "87843297-a6fa-46d4-ba5d-cb342fb2d3bb";
const DATASTORE_API = "https://data.milwaukee.gov/api/3/action/datastore_search";
const PAGE_SIZE = 10_000;
// 364-day scoring window + slack. 5 pages (50k rows) comfortably covers a year
// of Milwaukee volume; the loop stops early once a page crosses the cutoff.
const MAX_PAGES = 5;
const WINDOW_CUTOFF_MS = 400 * 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 10 * 60 * 1000;

import { milwaukeePolygons } from "../data/milwaukee-neighborhoods.js";

// Per-neighborhood centroid lookup from the bundled DCD polygon set.
const MKE_CENTROID: Record<string, { lat: number; lng: number }> =
  Object.fromEntries(milwaukeePolygons.map((p) => [p.name, p.centroid]));

// ---------------------------------------------------------------------------
// Wisconsin South State Plane (NAD83 / GRS80, legacy 2,000,000 ftUS false
// easting) → WGS84. Milwaukee's WIBR publishes block-rounded RoughX/RoughY in
// this projected system. This self-contained inverse Lambert Conformal Conic
// (2SP) lets us place every incident in its true DCD neighborhood by
// point-in-polygon — no external proj dependency. Parameters were calibrated
// against 7 geocoded WIBR addresses (mean 25 m error) and verified identical to
// proj4's EPSG-based transform to <1 mm.
const FT_US = 0.3048006096012192; // US survey foot in metres
const LCC_A = 6378137 / FT_US; // GRS80 semi-major axis, in ftUS
const LCC_E = Math.sqrt(2 / 298.257222101 - (1 / 298.257222101) ** 2);
const LCC_LAT0 = (42 * Math.PI) / 180;
const LCC_LON0 = (-90 * Math.PI) / 180;
const LCC_LAT1 = (44.0666666667 * Math.PI) / 180;
const LCC_LAT2 = (42.7333333333 * Math.PI) / 180;
const LCC_FALSE_EASTING_FT = 2_000_000; // false northing is 0
const lccM = (p: number) => Math.cos(p) / Math.sqrt(1 - LCC_E * LCC_E * Math.sin(p) ** 2);
const lccT = (p: number) =>
  Math.tan(Math.PI / 4 - p / 2) / Math.pow((1 - LCC_E * Math.sin(p)) / (1 + LCC_E * Math.sin(p)), LCC_E / 2);
const LCC_N =
  (Math.log(lccM(LCC_LAT1)) - Math.log(lccM(LCC_LAT2))) /
  (Math.log(lccT(LCC_LAT1)) - Math.log(lccT(LCC_LAT2)));
const LCC_F = lccM(LCC_LAT1) / (LCC_N * Math.pow(lccT(LCC_LAT1), LCC_N));
const LCC_RHO0 = LCC_A * LCC_F * Math.pow(lccT(LCC_LAT0), LCC_N);
export function statePlaneToLatLng(x: number, y: number): { lat: number; lng: number } {
  const xp = x - LCC_FALSE_EASTING_FT;
  const yp = y;
  const rho = Math.sign(LCC_N) * Math.sqrt(xp * xp + (LCC_RHO0 - yp) ** 2);
  const tt = Math.pow(rho / (LCC_A * LCC_F), 1 / LCC_N);
  const theta = Math.atan2(xp, LCC_RHO0 - yp);
  const lng = ((theta / LCC_N + LCC_LON0) * 180) / Math.PI;
  let phi = Math.PI / 2 - 2 * Math.atan(tt);
  for (let i = 0; i < 6; i++) {
    phi = Math.PI / 2 - 2 * Math.atan(tt * Math.pow((1 - LCC_E * Math.sin(phi)) / (1 + LCC_E * Math.sin(phi)), LCC_E / 2));
  }
  return { lat: (phi * 180) / Math.PI, lng };
}

// ---------------------------------------------------------------------------
// Point-in-polygon assignment over the 190 bundled DCD neighborhood polygons.
// Ray-casting with a bbox pre-filter (same pattern as long-beach / gainesville).
interface MkePolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const MKE_POLY_INDEX: MkePolyIndex[] = milwaukeePolygons.map((p) => {
  const rings: number[][][] =
    p.geometry.type === "Polygon"
      ? (p.geometry.coordinates as number[][][])
      : (p.geometry.coordinates as number[][][][]).flat();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const pt of ring) {
      if (pt[0] < minX) minX = pt[0];
      if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] < minY) minY = pt[1];
      if (pt[1] > maxY) maxY = pt[1];
    }
  }
  return { name: p.name, bbox: [minX, minY, maxX, maxY], rings };
});
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function neighborhoodForPoint(lng: number, lat: number): string | null {
  for (const p of MKE_POLY_INDEX) {
    if (lng < p.bbox[0] || lng > p.bbox[2] || lat < p.bbox[1] || lat > p.bbox[3]) continue;
    // Even-odd across all rings handles holes (and disjoint MultiPolygon parts).
    let inside = false;
    for (const ring of p.rings) if (pointInRing(lng, lat, ring)) inside = !inside;
    if (inside) return p.name;
  }
  return null;
}

interface RawRow {
  _id?: number;
  Case_Number?: string;
  Incident_Number?: string;
  Incident_Date?: string;          // "2026-06-10 03:00:00" — Central wall-clock
  Police_District?: string;
  Offense_All?: string;            // semicolon-separated NIBRS codes: "13B;13C"
  Location_All?: string;           // block address: "925 N MARTIN L KING JR DR"
  Address_Longitude?: string;      // WGS84, as text
  Address_Latitude?: string;
  Weapon_Used_All?: string;
}

// Milwaukee ZIPs → representative neighborhood name. v110: this is now only a
// FALLBACK for the rare row whose RoughX/RoughY coordinate is missing or lands
// in a boundary sliver outside every DCD polygon — the primary path resolves
// each incident to its actual neighborhood by point-in-polygon (see
// neighborhoodForPoint). Kept so no incident is dropped and the citywide total
// is preserved. ZIPs that straddle the city boundary map to the closest in-city
// name — MPD jurisdiction only extends to the city portions of those ZIPs.
const ZIP_NEIGHBORHOOD: Record<string, string> = {
  "53202": "Juneau Town",
  "53203": "Kilbourn Town",
  "53204": "Walker's Point",
  "53205": "Concordia",
  "53206": "Sherman Park",
  "53207": "Bay View",
  "53208": "Washington Park",
  "53209": "Granville Station",
  "53210": "Park West",
  "53211": "Upper East Side",
  "53212": "Riverwest",
  "53213": "West Town",
  "53214": "Story Hill",
  "53215": "Lincoln Village",
  "53216": "Sherman Park",
  "53217": "Bayside",
  "53218": "Capitol Heights",
  "53219": "Jackson Park",
  "53220": "Goldmann",
  "53221": "Tippecanoe",
  "53222": "Capitol Heights",
  "53223": "Brown Deer",
  "53224": "Granville",
  "53225": "Northridge Lakes",
  "53226": "Story Hill",
  "53227": "West Allis",
  "53228": "Greenfield",
  "53233": "Avenues West",
};

const PROVENANCE: DataProvenance = {
  source: "Milwaukee Police WIBR Crime Data · data.milwaukee.gov",
  datasetUrl: "https://data.milwaukee.gov/dataset/wibr",
  recency: "Daily refresh (NIBRS); mapped to DCD neighborhoods",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Milwaukee Police Department under WIBR/NIBRS and placed in their " +
    "Department of City Development neighborhood by reported location. Not live. CommunitySafe does not track individuals.",
};

// FBI NIBRS offense codes → app category + plain description. This is the
// fixed federal vocabulary (NIBRS User Manual); Offense_All carries one or
// more of these, semicolon-separated. Robbery (120) is PERSONS here — the app
// groups it with violent crime, matching every sister adapter.
const NIBRS_PERSONS: Record<string, string> = {
  "09A": "HOMICIDE", "09B": "NEGLIGENT MANSLAUGHTER", "09C": "JUSTIFIABLE HOMICIDE",
  "100": "KIDNAPPING / ABDUCTION",
  "11A": "SEXUAL ASSAULT", "11B": "SEXUAL ASSAULT", "11C": "SEXUAL ASSAULT", "11D": "SEX OFFENSE (FONDLING)",
  "120": "ROBBERY",
  "13A": "AGGRAVATED ASSAULT", "13B": "SIMPLE ASSAULT", "13C": "INTIMIDATION",
  "36A": "SEX OFFENSE (INCEST)", "36B": "SEX OFFENSE (STATUTORY)",
  "64A": "HUMAN TRAFFICKING", "64B": "HUMAN TRAFFICKING",
};
const NIBRS_PROPERTY: Record<string, string> = {
  "200": "ARSON", "210": "EXTORTION / BLACKMAIL", "220": "BURGLARY",
  "23A": "THEFT (POCKET-PICKING)", "23B": "THEFT (PURSE-SNATCHING)", "23C": "SHOPLIFTING",
  "23D": "THEFT FROM BUILDING", "23E": "THEFT FROM COIN MACHINE", "23F": "THEFT FROM MOTOR VEHICLE",
  "23G": "THEFT OF VEHICLE PARTS", "23H": "THEFT (OTHER)",
  "240": "MOTOR VEHICLE THEFT", "250": "COUNTERFEITING / FORGERY",
  "26A": "FRAUD (FALSE PRETENSES)", "26B": "FRAUD (CREDIT CARD / ATM)", "26C": "FRAUD (IMPERSONATION)",
  "26D": "FRAUD (WELFARE)", "26E": "FRAUD (WIRE)", "26F": "IDENTITY THEFT", "26G": "HACKING / COMPUTER INVASION",
  "270": "EMBEZZLEMENT", "280": "STOLEN PROPERTY OFFENSE", "290": "CRIMINAL DAMAGE / VANDALISM",
  "510": "BRIBERY",
};
const NIBRS_SOCIETY: Record<string, string> = {
  "35A": "DRUG / NARCOTIC VIOLATION", "35B": "DRUG EQUIPMENT VIOLATION",
  "370": "PORNOGRAPHY / OBSCENE MATERIAL",
  "39A": "GAMBLING (BETTING)", "39B": "GAMBLING (PROMOTING)", "39C": "GAMBLING EQUIPMENT", "39D": "SPORTS TAMPERING",
  "40A": "PROSTITUTION", "40B": "ASSISTING PROSTITUTION", "40C": "PURCHASING PROSTITUTION",
  "520": "WEAPON LAW VIOLATION", "720": "ANIMAL CRUELTY",
};

// A row can carry several codes ("90Z;290;13B"). Classify each and report the
// most serious bucket: PERSONS > PROPERTY > SOCIETY; the description follows
// the code that won. Unknown / Group B (90x) codes fall through to SOCIETY.
function classifyOffenses(offenseAll: string | undefined): { category: CrimeCategory; description: string } {
  const codes = (offenseAll ?? "").split(/[;,]/).map((c) => c.trim().toUpperCase()).filter(Boolean);
  let property: string | null = null;
  let society: string | null = null;
  for (const code of codes) {
    const p = NIBRS_PERSONS[code];
    if (p) return { category: CrimeCategory.PERSONS, description: p };
    if (!property && NIBRS_PROPERTY[code]) property = NIBRS_PROPERTY[code];
    if (!society && NIBRS_SOCIETY[code]) society = NIBRS_SOCIETY[code];
  }
  if (property) return { category: CrimeCategory.PROPERTY, description: property };
  if (society) return { category: CrimeCategory.SOCIETY, description: society };
  return { category: CrimeCategory.SOCIETY, description: "OTHER OFFENSE" };
}

function parseDateMaybe(raw: string | undefined): Date | null {
  if (!raw) return null;
  // v99 — was `new Date(raw.replace(" ","T") + "Z")`, which asserted
  // Milwaukee local wall-clock IS UTC and shifted every incident ~5-6h.
  // cityLocalToUtcIso converts the Central wall-clock to the true instant.
  const d = new Date(cityLocalToUtcIso(raw, "America/Chicago"));
  return d.getTime() <= 0 ? null : d;
}

interface DatastoreResp { success?: boolean; result?: { records?: RawRow[]; total?: number } }

async function fetchPage(offset: number, signal?: AbortSignal): Promise<RawRow[]> {
  // Sorted by Incident_Date desc — NOT _id. The datastore's _id follows CSV
  // load/edit order, so its tail is dominated by recently-EDITED old incidents
  // (e.g. a Jan-2024 case amended last month); paging by _id desc is what made
  // the adapter fetch 10k stale rows and grade the city N/A after the dataset
  // grew past one page. Date-desc pages = the newest incidents first, always.
  const url = `${DATASTORE_API}?resource_id=${MILWAUKEE_RESOURCE_ID}` +
    `&limit=${PAGE_SIZE}&offset=${offset}&sort=${encodeURIComponent("Incident_Date desc")}`;
  const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`Milwaukee datastore ${res.status} at offset ${offset}`);
  const body = (await readJson(res)) as DatastoreResp;
  return body.result?.records ?? [];
}

interface Cache { fetchedAt: number; rows: Incident[]; areas: KnownArea[] }
let cache: Cache | null = null;
registerRowCache(() => { cache = null; }, "milwaukee-ckan");
let lastDiscovered: { fetchedAt: number; areas: KnownArea[] } | null = null;
// Dedupe the placement-summary log so the warm-worker doesn't spam it every call.
let lastMilwaukeePlacementLog = "";

// Milwaukee metro centroid — last-resort fallback when a neighborhood
// name doesn't exist in the bundled polygon set (suburbs that the
// ZIP-to-neighborhood map points to, edge cases).
const MILWAUKEE_METRO_CENTROID = { lat: 43.0389, lng: -87.9065 };

function nbhSlug(name: string): string {
  return `mke-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

// Static seed — every Milwaukee neighborhood from the polygon dataset
// becomes an area entry. Guarantees cold instances always have the
// full neighborhood list ready for the picker.
const STATIC_MILWAUKEE_AREAS: KnownArea[] = milwaukeePolygons.map((p) => ({
  slug: nbhSlug(p.name),
  label: p.name,
  jurisdiction: "Milwaukee",
  centroid: p.centroid,
}));

async function fetchAndParse(): Promise<Cache> {
  // Date-desc pages until the scoring window (+slack) is covered. The dataset
  // is ~100k rows spanning multiple years; only the newest slice matters.
  const cutoff = Date.now() - WINDOW_CUTOFF_MS;
  const rawRows: RawRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await fetchPage(page * PAGE_SIZE).catch((err) => {
      console.warn("[milwaukee] fetchPage failed:", (err as Error).message);
      return [] as RawRow[];
    });
    if (batch.length === 0) break;
    rawRows.push(...batch);
    const oldest = parseDateMaybe(batch[batch.length - 1]?.Incident_Date);
    if (oldest && +oldest < cutoff) break; // window covered
    if (batch.length < PAGE_SIZE) break;   // dataset exhausted
  }

  const rows: Incident[] = [];
  const nbhCounts = new Map<string, number>();
  let placedByPoint = 0;
  let unplaced = 0;
  for (const r of rawRows) {
    const occurred = parseDateMaybe(r.Incident_Date);
    if (!occurred) continue;

    // v110 semantics preserved: resolve each incident to its ACTUAL DCD
    // neighborhood (190 of them) by point-in-polygon — the new schema ships
    // WGS84 Address_Latitude/Longitude directly, so the state-plane transform
    // is no longer in this path. Rows without usable coordinates, or landing
    // outside every city polygon (suburb slivers, redacted locations), are
    // skipped — there is no ZIP column to fall back on anymore.
    const lat = Number(r.Address_Latitude);
    const lng = Number(r.Address_Longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 42.6 || lat > 43.4 || lng < -88.4 || lng > -87.5) {
      unplaced++;
      continue;
    }
    const nbh = neighborhoodForPoint(lng, lat);
    if (!nbh) { unplaced++; continue; }
    placedByPoint++;

    const { category, description } = classifyOffenses(r.Offense_All);
    rows.push({
      id: `mke-${r.Incident_Number ?? r.Case_Number ?? `${rows.length}`}`,
      area: nbh,
      occurredAt: occurred.toISOString(),
      nibrsCategory: category,
      ibrOffenseDescription: description,
      beat: r.Police_District ? `District ${r.Police_District}` : null,
      blockLabel: r.Location_All ?? undefined,
    });
    nbhCounts.set(nbh, (nbhCounts.get(nbh) ?? 0) + 1);
  }
  // fix(deploy-log-spam): runs on every adapter call, so the warm-worker
  // logged this identical line thousands of times, drowning real errors.
  // Dedupe — only log when the placement summary actually changes.
  if (placedByPoint > 0) {
    const sig = `${placedByPoint}/${unplaced}/${nbhCounts.size}`;
    if (sig !== lastMilwaukeePlacementLog) {
      lastMilwaukeePlacementLog = sig;
      console.log(`[milwaukee] placed ${placedByPoint} by point-in-polygon (${unplaced} outside coverage), ${nbhCounts.size} neighborhoods`);
    }
  }

  const areas: KnownArea[] = Array.from(nbhCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([nbh]) => ({
      slug: nbhSlug(nbh),
      label: nbh,
      jurisdiction: "Milwaukee",
      centroid: MKE_CENTROID[nbh] ?? MILWAUKEE_METRO_CENTROID,
    }));

  return { fetchedAt: Date.now(), rows, areas };
}

async function getCached(): Promise<Cache | null> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache;
  try {
    const fresh = await fetchAndParse();
    cache = fresh;
    if (fresh.areas.length > 0) lastDiscovered = { fetchedAt: now, areas: fresh.areas };
    return fresh;
  } catch (err) {
    console.warn("[milwaukee] fetchAndParse failed:", (err as Error).message);
    return cache;
  }
}

export async function getDiscoveredAreas(): Promise<KnownArea[]> {
  const c = await getCached();
  if (c && c.areas.length > 0) return c.areas;
  if (lastDiscovered) return lastDiscovered.areas;
  // Static floor — guaranteed non-empty so the picker always has options
  // and per-area safety-score calls don't 404 on a cold instance.
  return STATIC_MILWAUKEE_AREAS;
}

export { getDiscoveredAreas as getDiscoveredAreasMilwaukee };

/// Resolve a Milwaukee area slug ("mke-bay-view") to the actual
/// neighborhood label as stored on r.area. Legacy ZIP-style slugs
/// ("mke-53202") map via ZIP_NEIGHBORHOOD.
function labelForMkeSlug(slug: string): string {
  const want = slug.replace(/^mke-/, "");
  if (/^\d{5}$/.test(want)) {
    return ZIP_NEIGHBORHOOD[want] ?? `Milwaukee ${want}`;
  }
  const hit = milwaukeePolygons.find((p) => nbhSlug(p.name) === slug);
  return hit?.name ?? slug;
}

export const milwaukeeAdapter: CrimeDataAdapter = {
  name: "milwaukee-ckan",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const c = await getCached();
    if (!c) return null;
    const label = labelForMkeSlug(area);
    const incs = c.rows.filter((r) => r.area === label);
    if (incs.length === 0) return null;
    return {
      area: label,
      crimeRate: null,
      violentCrimeRate: null,
      propertyCrimeRate: null,
      // Self-calibrating quintile bands over Milwaukee's own
      // per-neighborhood distribution; degrades to the prior thresholds.
      riskLevel: riskLevelFromAreaCounts(c.rows, incs.length, [20, 80, 200, 500]),
      provenance: PROVENANCE,
    };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const c = await getCached();
    if (!c) return [];
    const label = labelForMkeSlug(area);
    let filtered = c.rows.filter((r) => r.area === label);
    if (opts?.since) {
      const cutoff = +opts.since;
      filtered = filtered.filter((r) => +new Date(r.occurredAt) >= cutoff);
    }
    if (opts?.limit && filtered.length > opts.limit) filtered = filtered.slice(0, opts.limit);
    return filtered;
  },

  async getRecentReports(area: string, opts?: { limit?: number }) {
    const c = await getCached();
    if (!c) return [];
    const label = labelForMkeSlug(area);
    const filtered = c.rows.filter((r) => r.area === label);
    // v95p35 — sort newest-first so the Recent-Incidents card renders
    // in chronological order. Sister adapters all sort here; Phoenix
    // + Milwaukee were the only outliers.
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
};
