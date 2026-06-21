import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { fetchSocrata } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";
import { mesaPolygons } from "../data/mesa-council-districts.js";

// Mesa, AZ — Mesa Police Department "Police Incidents" on data.mesaaz.gov
// (Socrata dataset hpbg-2wph). Incident-level rows with a GeoJSON `location`
// point (WGS84), a DATE-ONLY occurrence date (`occurred_date`, always
// 00:00:00 — no real hour), a NIBRS-ish offense (`crime_type` /
// `nibrs_description`) and the FBI Crimes-Against bucket (`crime_against` =
// Person / Property / Society / Uncategorized). The feed carries NO area
// field (no beat / grid / council district), so we geocode each incident to
// one of Mesa's 6 official city council districts via point-in-polygon (same
// pattern as the Long Beach adapter). Updates daily.
//
// DATE-ONLY: Mesa must be added to DATE_ONLY_CITY_SLUGS (slug "mesa") so the
// "When incidents happen" card / time-of-day insight suppress themselves
// instead of fabricating a midnight spike. occurredAt is built at local noon
// (America/Phoenix — no DST) so the calendar day is unambiguous in either TZ.

const BASE = "https://data.mesaaz.gov/resource/hpbg-2wph.json";
const MESA_TZ = "America/Phoenix";
const ROW_LIMIT = 50_000; // Socrata hard ceiling; ~51k rows / 400d at Mesa volume
const WINDOW_DAYS = 400; // a touch over a year so the 365d score window is fully covered
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; }, "mesa-socrata");

interface MesaRow {
  crime_id?: string;
  crime_type?: string;
  nibrs_description?: string;
  /// Occurrence date — DATE ONLY (floating_timestamp, always 00:00:00).
  occurred_date?: string;
  /// Filing date; kept as a fallback when occurred_date is missing.
  report_date?: string;
  /// FBI Crimes-Against bucket: "Person" | "Property" | "Society" |
  /// "Uncategorized" | "Not a Crime".
  crime_against?: string;
  /// GeoJSON point { type: "Point", coordinates: [lng, lat] }.
  location?: { type?: string; coordinates?: [number, number] };
}

// Mesa publishes the FBI Crimes-Against bucket directly (`crime_against`).
// Robbery is filed by NIBRS under Property but the FBI UCR counts it as a
// Part-1 VIOLENT offense, so force it to PERSONS (same convention as the
// Long Beach / Dallas / Saint Paul adapters). A large share of rows come
// through as "Uncategorized" (warrant arrests / admin entries) — those fall
// through to SOCIETY, which is the correct honest bucket (they are neither
// Part-1 violent nor property crimes).
function classify(row: MesaRow): CrimeCategory {
  const offense = `${row.crime_type ?? ""} ${row.nibrs_description ?? ""}`.toUpperCase();
  if (offense.includes("ROBBERY")) return CrimeCategory.PERSONS;
  const against = (row.crime_against ?? "").trim().toLowerCase();
  if (against === "person") return CrimeCategory.PERSONS;
  if (against === "property") return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// Point-in-polygon geocoder over Mesa's 6 official council districts.
// bbox-prefiltered ray casting — same self-contained pattern as the
// Long Beach / Indianapolis / Boston / Philadelphia adapters.
interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = mesaPolygons.map((p) => {
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
function geocodeMesa(lng: number, lat: number): string | null {
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
  source: "Mesa Police Department Police Incidents (City of Mesa Open Data)",
  datasetUrl: "https://data.mesaaz.gov/Police/Police-Incidents/hpbg-2wph",
  recency: "Refreshed daily by the Mesa Police Department; dates are date-only (no time of day)",
  granularity: "jurisdiction",
  disclaimer:
    "Incidents are reported by the Mesa Police Department and geocoded to one of Mesa's " +
    "6 official city council districts — not live, not street-level, and the feed carries " +
    "no time of day. CommunitySafe does not track individuals.",
};

// DATE-ONLY: occurred_date has no real hour (always 00:00:00). Build
// occurredAt at LOCAL NOON in America/Phoenix so the calendar day is
// unambiguous regardless of the runtime TZ. Returns null for unparseable
// input so epoch-fallback rows don't pollute the citywide window.
function occurredAtFor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const ymd = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const iso = cityLocalToUtcIso(`${ymd}T12:00:00`, MESA_TZ);
  return +new Date(iso) <= 0 ? null : iso;
}

// Explicit $select — Mesa publishes no demographic columns, but keep it
// explicit so a future schema addition doesn't accidentally pull them.
const MESA_SELECT = "crime_id,crime_type,nibrs_description,occurred_date,report_date,crime_against,location";
const MESA_WHERE = "location IS NOT NULL AND occurred_date IS NOT NULL";

async function fetchMesa(): Promise<Incident[]> {
  const rows = await fetchSocrata<MesaRow>("Mesa Socrata", {
    url: BASE,
    select: MESA_SELECT,
    where: MESA_WHERE,
    windowDays: WINDOW_DAYS,
    dateField: "occurred_date",
    order: "occurred_date DESC",
    limit: ROW_LIMIT,
  });
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const occurredAt = occurredAtFor(r.occurred_date ?? r.report_date);
    if (!occurredAt) continue;
    const coords = r.location?.coordinates;
    const lng = Array.isArray(coords) ? Number(coords[0]) : NaN;
    const lat = Array.isArray(coords) ? Number(coords[1]) : NaN;
    // Filter null-island / missing coords — without a point we can't assign a
    // district (the feed has no other area field).
    if (!isFinite(lat) || !isFinite(lng) || lat === 0 || lng === 0) continue;
    const district = geocodeMesa(lng, lat);
    if (!district) continue; // outside every Mesa council district → not Mesa
    out.push({
      id: `mesa-${r.crime_id ?? i}`,
      area: district,
      occurredAt,
      nibrsCategory: classify(r),
      ibrOffenseDescription: titleCaseOffense(r.crime_type ?? r.nibrs_description ?? "Unknown"),
      beat: null,
      blockLabel: undefined,
      lat,
      lng,
    });
  }
  return out;
}

// In-flight fetch dedup: the dispatcher fans a per-area Promise.all over every
// district, so a cold cache would otherwise fire N concurrent full fetches.
let inFlightMesaFetch: Promise<Incident[]> | null = null;
export async function getRowsMesa(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightMesaFetch) return inFlightMesaFetch;
  inFlightMesaFetch = (async () => {
    try {
      const rows = await fetchMesa();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[mesa] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightMesaFetch = null;
    }
  })();
  return inFlightMesaFetch;
}

export async function getDiscoveredAreasMesa(): Promise<KnownArea[]> {
  const rows = await getRowsMesa();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area) continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat; e.lngSum += r.lng; e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 3)
    .map(([name, e]) => ({
      slug: `mesa-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Mesa",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForMesaSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("mesa-") ? s.slice(5) : s;
  for (const r of rows) {
    const cand = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (cand === want) return r.area;
  }
  return null;
}

export const mesaAdapter: CrimeDataAdapter = {
  name: "mesa-socrata",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsMesa();
    const label = labelForMesaSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    // Districts are large (6 across the whole city), so per-district counts run
    // far higher than a neighborhood adapter's — bands scaled accordingly.
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [500, 1500, 3000, 6000]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },
  async getIncidents(area, opts) {
    const rows = await getRowsMesa();
    const label = labelForMesaSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area, opts) { return this.getIncidents(area, { limit: opts?.limit ?? 20 }); },
};
