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
// CKAN datastore (resource 87843297-a6fa-46d4-ba5d-cb342fb2d3bb) holds
// ~9.4k incidents with per-incident boolean offense flags AND block-rounded
// state-plane coordinates (RoughX/RoughY). We pull the full dataset in one
// request, place each incident in its actual DCD neighborhood by
// point-in-polygon, and map the boolean flags to NIBRS three-way buckets.

const MILWAUKEE_RESOURCE_ID = "87843297-a6fa-46d4-ba5d-cb342fb2d3bb";
const DATASTORE_API = "https://data.milwaukee.gov/api/3/action/datastore_search";
const PAGE_SIZE = 10_000; // dataset total is ~9.4k; one page covers it
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
  IncidentNum?: string;
  ReportedDateTime?: string;
  Location?: string;
  ZIP?: string;
  // Block-rounded Wisconsin State Plane coordinates (privacy-preserving but
  // neighborhood-accurate). Used to place each incident in its actual DCD
  // neighborhood via point-in-polygon. See statePlaneToLatLng below.
  RoughX?: string;
  RoughY?: string;
  // Boolean-ish counts: 0/1 per offense category. Multiple can be set per
  // incident (e.g. burglary + criminal damage); we pick the highest-
  // precedence offense to drive the row's nibrsCategory + description.
  Arson?: string;
  AssaultOffense?: string;
  Burglary?: string;
  CriminalDamage?: string;
  Homicide?: string;
  LockedVehicle?: string;
  Robbery?: string;
  SexOffense?: string;
  Theft?: string;
  VehicleTheft?: string;
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

// ZIPs whose footprint is overwhelmingly a SEPARATE municipality with its own
// police department — the MPD WIBR feed carries only a stray boundary sliver,
// so grading them as Milwaukee neighborhoods is both data-poor (N/A) and
// misleading (they're labeled after the suburb). Excluded from aggregation.
// 53227 West Allis · 53228 Greenfield · 53223 Brown Deer.
const NON_MPD_ZIPS: ReadonlySet<string> = new Set(["53227", "53228", "53223"]);

const PROVENANCE: DataProvenance = {
  source: "Milwaukee Police WIBR Crime Data · data.milwaukee.gov",
  datasetUrl: "https://data.milwaukee.gov/dataset/wibr",
  recency: "Daily refresh; mapped to DCD neighborhoods",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Milwaukee Police Department under WIBR and placed in their " +
    "Department of City Development neighborhood by block-rounded location. Not live. CommunitySafe does not track individuals.",
};

// Each row may have multiple offense flags set. Pick the highest-
// precedence one (most serious / most informative) to drive the row's
// reported category. Ties are resolved in this order.
function classifyRow(r: RawRow): { category: CrimeCategory; description: string } {
  const yes = (v: string | undefined) => v === "1" || v === "true" || v === "TRUE";
  // PERSONS — order: Homicide > SexOffense > Robbery > AssaultOffense
  if (yes(r.Homicide))       return { category: CrimeCategory.PERSONS,  description: "HOMICIDE" };
  if (yes(r.SexOffense))     return { category: CrimeCategory.PERSONS,  description: "SEX OFFENSE" };
  if (yes(r.Robbery))        return { category: CrimeCategory.PERSONS,  description: "ROBBERY" };
  if (yes(r.AssaultOffense)) return { category: CrimeCategory.PERSONS,  description: "ASSAULT" };
  // PROPERTY — order: Arson > Burglary > VehicleTheft > Theft > CriminalDamage > LockedVehicle
  if (yes(r.Arson))          return { category: CrimeCategory.PROPERTY, description: "ARSON" };
  if (yes(r.Burglary))       return { category: CrimeCategory.PROPERTY, description: "BURGLARY" };
  if (yes(r.VehicleTheft))   return { category: CrimeCategory.PROPERTY, description: "MOTOR VEHICLE THEFT" };
  if (yes(r.Theft))          return { category: CrimeCategory.PROPERTY, description: "THEFT" };
  if (yes(r.CriminalDamage)) return { category: CrimeCategory.PROPERTY, description: "CRIMINAL DAMAGE" };
  if (yes(r.LockedVehicle))  return { category: CrimeCategory.PROPERTY, description: "LOCKED VEHICLE ENTRY" };
  // SOCIETY fallback if no flag set — shouldn't normally happen but
  // we'd rather render the row than drop it silently.
  return { category: CrimeCategory.SOCIETY, description: "OTHER" };
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
  const url = `${DATASTORE_API}?resource_id=${MILWAUKEE_RESOURCE_ID}` +
    `&limit=${PAGE_SIZE}&offset=${offset}&sort=${encodeURIComponent("_id desc")}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Milwaukee datastore ${res.status} at offset ${offset}`);
  const body = (await readJson(res)) as DatastoreResp;
  return body.result?.records ?? [];
}

interface Cache { fetchedAt: number; rows: Incident[]; areas: KnownArea[] }
let cache: Cache | null = null;
registerRowCache(() => { cache = null; }, "milwaukee-ckan");
let lastDiscovered: { fetchedAt: number; areas: KnownArea[] } | null = null;

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
  // Try one big page first; if it returns the full count we're done.
  // The dataset is ~9.4k rows so one PAGE_SIZE=10k fetch covers it.
  const rawRows = await fetchPage(0).catch((err) => {
    console.warn("[milwaukee] fetchPage failed:", (err as Error).message);
    return [] as RawRow[];
  });

  const rows: Incident[] = [];
  const nbhCounts = new Map<string, number>();
  let placedByPoint = 0;
  let placedByZip = 0;
  for (const r of rawRows) {
    const occurred = parseDateMaybe(r.ReportedDateTime);
    if (!occurred) continue;

    // v110 — resolve each incident to its ACTUAL DCD neighborhood (190 of
    // them) via its block-rounded state-plane coordinate + point-in-polygon,
    // instead of the old coarse ZIP→one-representative-name bucketing. This
    // is what residents recognize ("Riverwest", "Bay View", "Sherman Park")
    // and lifts Milwaukee from ~21 ZIP buckets to its real neighborhood map.
    let nbh: string | null = null;
    const rx = Number(r.RoughX);
    const ry = Number(r.RoughY);
    if (Number.isFinite(rx) && Number.isFinite(ry) && rx > 0 && ry > 0) {
      const { lat, lng } = statePlaneToLatLng(rx, ry);
      nbh = neighborhoodForPoint(lng, lat);
      if (nbh) placedByPoint++;
    }
    // Fallback: rows missing coords or landing in a boundary sliver keep the
    // ZIP→neighborhood mapping so no incident is dropped and the citywide
    // total is preserved. NON_MPD suburb ZIPs are still excluded.
    if (!nbh) {
      const zip = (r.ZIP ?? "").trim();
      if (/^\d{5}$/.test(zip) && !NON_MPD_ZIPS.has(zip)) {
        nbh = ZIP_NEIGHBORHOOD[zip] ?? null;
        if (nbh) placedByZip++;
      }
    }
    if (!nbh) continue;

    const { category, description } = classifyRow(r);
    rows.push({
      id: `mke-${r.IncidentNum ?? `${rows.length}`}`,
      area: nbh,
      occurredAt: occurred.toISOString(),
      nibrsCategory: category,
      ibrOffenseDescription: description,
      beat: null,
      blockLabel: r.Location ?? undefined,
    });
    nbhCounts.set(nbh, (nbhCounts.get(nbh) ?? 0) + 1);
  }
  if (placedByPoint + placedByZip > 0) {
    console.log(`[milwaukee] placed ${placedByPoint} by point-in-polygon, ${placedByZip} by ZIP fallback, ${nbhCounts.size} neighborhoods`);
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
