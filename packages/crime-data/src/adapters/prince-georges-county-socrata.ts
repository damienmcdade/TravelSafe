import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { fetchSocrata } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";
import { princeGeorgesPolygons } from "../data/prince-georges-county-neighborhoods.js";

// Prince George's County, MD — PGPD reported crime/incident dataset (Socrata
// xjru-idbe on data.princegeorgescountymd.gov). Keyless, ~74k rows over a rolling
// ~3-year window, fresh to within a few days. Each row carries scalar
// latitude/longitude and a free-text `clearance_code_inc_type` offense label
// ("THEFT FROM AUTO", "AUTO, STOLEN", "ASSAULT", "ROBBERY, VEHICLE", "B & E,
// RESIDENTIAL", "SEX OFFENSE"…) which we keyword-classify into the NIBRS
// PERSONS / PROPERTY / SOCIETY buckets. Traffic/administrative rows (ACCIDENT,
// ALARM, SERVICE, LOCATE) are dropped at ingest.
//
// The feed carries NO place name, so each incident is placed in one of the
// county's recognizable constituent communities (Bowie, College Park, Hyattsville,
// Laurel, Greenbelt, Suitland, Oxon Hill, Clinton, Fort Washington…) by
// point-in-polygon over the Census TIGER place set (see
// data/prince-georges-county-neighborhoods.ts) — the same polygon set that powers
// apps/web/public/geo/prince-georges-county.geojson.
// Source: https://data.princegeorgescountymd.gov/resource/xjru-idbe.json

const BASE = "https://data.princegeorgescountymd.gov/resource/xjru-idbe.json";
const TZ = "America/New_York";
const ROW_LIMIT = 50_000;
const WINDOW_DAYS = 365;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; }, "prince-georges-county-socrata");

interface PgRow {
  incident_case_id?: string;
  date?: string;
  clearance_code_inc_type?: string;
  pgpd_sector?: string;
  pgpd_beat?: string;
  street_address?: string;
  latitude?: string;
  longitude?: string;
  location?: { type: "Point"; coordinates: [number, number] };
}

// ---- Free-text incident-type → NIBRS classify ---------------------------
// ROBBERY first → PERSONS (FBI UCR Part-1 VIOLENT), so "ROBBERY, VEHICLE" isn't
// swept into PROPERTY by a later key.
const PERSONS_KEYS = [
  "ROBBERY", "ASSAULT", "HOMICIDE", "MURDER", "MANSLAUGHTER", "SHOOTING",
  "KIDNAP", "ABDUCT", "RAPE", "SEX OFFENSE", "SEX ASSAULT", "CARJACK",
  "STABBING", "WEAPON ON PERSON",
];
const PROPERTY_KEYS = [
  "THEFT", "STOLEN", "STEAL", "B & E", "B&E", "BURGLARY", "LARCENY",
  "SHOPLIFT", "VANDAL", "DESTRUCTION", "DAMAGE", "ARSON", "FORGERY",
  "FRAUD", "COUNTERFEIT", "EMBEZZLE", "IDENTITY", "STOLEN PROPERTY",
  "RECOVERED", "TAMPER",
];
const SOCIETY_KEYS = [
  "DRUG", "NARCOTIC", "CDS", "WEAPON", "FIREARM", "GUN", "TRESPASS",
  "DISORDERLY", "PROSTITUTION", "LIQUOR", "ALCOHOL", "DUI",
];
// Traffic + administrative / non-criminal call types we want to guarantee are
// dropped. NOTE: these are only consulted AFTER positive crime classification
// fails — a real crime label must never be dropped because it incidentally
// contains one of these broad words (e.g. a hypothetical "DEATH, HOMICIDE" must
// classify as PERSONS, not be swept out by "DEATH"). In practice any non-crime
// label already falls through to null, so this list is belt-and-suspenders
// documentation of the known PGPD admin/traffic types.
const SKIP_KEYS = [
  "ACCIDENT", "ALARM", "SERVICE", "LOCATE", "ASSIST", "CHECK", "WELFARE",
  "MISSING", "SUSPICIOUS", "INFORMATION", "LOST", "FOUND", "WARRANT SERVICE",
  "DEATH", "SICK", "MENTAL", "TRAFFIC", "PARKING", "ABANDONED",
];
function classify(t: string): CrimeCategory | null {
  const s = t.toUpperCase();
  if (!s) return null;
  // Positive crime classification WINS — a real offense is never dropped because
  // it happens to contain an admin word. ROBBERY is keyed first so "ROBBERY,
  // VEHICLE" lands in PERSONS, not PROPERTY.
  if (PERSONS_KEYS.some((k) => s.includes(k))) return CrimeCategory.PERSONS;
  if (PROPERTY_KEYS.some((k) => s.includes(k))) return CrimeCategory.PROPERTY;
  if (SOCIETY_KEYS.some((k) => s.includes(k))) return CrimeCategory.SOCIETY;
  // Not a Part-1/society crime — traffic, admin, and everything uncategorized
  // (incl. SKIP_KEYS) is dropped so it never inflates the counts.
  if (SKIP_KEYS.some((k) => s.includes(k))) return null;
  return null;
}

// ---- Point-in-polygon over the named PG places --------------------------
interface PolyIndex { name: string; bbox: [number, number, number, number]; cx: number; cy: number; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = princeGeorgesPolygons.map((p) => {
  const rings: number[][][] = p.geometry.type === "Polygon"
    ? (p.geometry.coordinates as number[][][])
    : (p.geometry.coordinates as number[][][][]).flat();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { name: p.name, bbox: [minX, minY, maxX, maxY], cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, rings };
});
const SNAP_CAP_KM = 4;
function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function geocode(lng: number, lat: number): string | null {
  for (const p of POLY_INDEX) {
    const [minX, minY, maxX, maxY] = p.bbox;
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
    let parity = 0;
    for (const ring of p.rings) if (pointInRing(lng, lat, ring)) parity++;
    if (parity % 2 === 1) return p.name;
  }
  let best: string | null = null, bestD2 = Infinity;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (const p of POLY_INDEX) {
    const dx = (lng - p.cx) * cosLat, dy = lat - p.cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = p.name; }
  }
  const capDeg = SNAP_CAP_KM / 111;
  return bestD2 <= capDeg * capDeg ? best : null;
}

const PROVENANCE: DataProvenance = {
  source: "Prince George's County Police Department Reported Crime (Prince George's County, MD Open Data, Socrata) · place boundaries © US Census Bureau TIGER/Line",
  datasetUrl: "https://data.princegeorgescountymd.gov/Public-Safety/PGPD-Reported-Crime/xjru-idbe",
  recency: "Refreshed routinely by Prince George's County Police (recent ~12-month window)",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Prince George's County Police Department and placed in one of the " +
    "county's recognizable constituent communities (Bowie, College Park, Hyattsville, Laurel, " +
    "Greenbelt, Suitland, Oxon Hill, Clinton, Fort Washington…) by their public coordinate, using " +
    "US Census place boundaries. Traffic and administrative call types are dropped; points outside " +
    "every mapped place are bucketed as \"Unmapped\" but still count countywide. CommunitySafe does not track individuals.",
};

async function fetchPg(): Promise<Incident[]> {
  const rows = await fetchSocrata<PgRow>("Prince George's County PD", {
    url: BASE,
    select: "incident_case_id,date,clearance_code_inc_type,pgpd_sector,pgpd_beat,street_address,latitude,longitude,location",
    where: "latitude IS NOT NULL OR location IS NOT NULL",
    windowDays: WINDOW_DAYS,
    dateField: "date",
    order: "date DESC",
    limit: ROW_LIMIT,
  });
  const out: Incident[] = [];
  for (const r of rows) {
    const desc = r.clearance_code_inc_type?.trim() ?? "";
    const cat = classify(desc);
    if (cat == null) continue;
    const occurredAt = cityLocalToUtcIso(r.date, TZ);
    if (+new Date(occurredAt) <= 0) continue;
    const coords = r.location?.coordinates;
    let lng = coords ? Number(coords[0]) : Number(r.longitude);
    let lat = coords ? Number(coords[1]) : Number(r.latitude);
    if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) { lat = NaN; lng = NaN; }
    const area = (!isNaN(lat) && !isNaN(lng)) ? (geocode(lng, lat) ?? "Unmapped") : "Unmapped";
    out.push({
      id: `pg-${r.incident_case_id ?? out.length}`,
      area,
      occurredAt,
      nibrsCategory: cat,
      ibrOffenseDescription: titleCaseOffense(desc),
      beat: r.pgpd_beat ? `Beat ${r.pgpd_beat}` : null,
      blockLabel: r.street_address ?? undefined,
      lat: !isNaN(lat) ? lat : undefined,
      lng: !isNaN(lng) ? lng : undefined,
    });
  }
  return out;
}

let inFlightPgFetch: Promise<Incident[]> | null = null;
export async function getRowsPrinceGeorgesCounty(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightPgFetch) return inFlightPgFetch;
  inFlightPgFetch = (async () => {
    try {
      const rows = await fetchPg();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[prince-georges-county] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightPgFetch = null;
    }
  })();
  return inFlightPgFetch;
}

export async function getDiscoveredAreasPrinceGeorgesCounty(): Promise<KnownArea[]> {
  const rows = await getRowsPrinceGeorgesCounty();
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
      slug: `pg-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Prince George's County",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForPgSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("pg-") ? s.slice(3) : s;
  for (const r of rows) {
    const cand = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (cand === want) return r.area;
  }
  return null;
}

export const princeGeorgesCountyAdapter: CrimeDataAdapter = {
  name: "prince-georges-county-socrata",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsPrinceGeorgesCounty();
    const label = labelForPgSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [40, 120, 300, 700]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },
  async getIncidents(area, opts) {
    const rows = await getRowsPrinceGeorgesCounty();
    const label = labelForPgSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area, opts) { return this.getIncidents(area, { limit: opts?.limit ?? 20 }); },
};
