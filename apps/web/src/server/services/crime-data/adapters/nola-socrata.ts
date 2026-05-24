import "server-only";
import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";
import { nolaPolygons } from "../../../data/new-orleans-neighborhoods";

// New Orleans — NOPD Calls for Service 2026.
// Socrata dataset es9j-6y5d on data.nola.gov. Live (newest entries minutes
// old). NO demographic columns published. Per-call type code + descriptive
// label; one row per radio call, not per crime report.
//
// IMPORTANT: NOPD's older "Electronic Police Report" dataset (qtcu-97s9)
// publishes offender_race / victim_race / etc. — we DO NOT read that
// dataset. The Calls for Service feed is the only acceptable upstream.

const BASE = "https://data.nola.gov/resource/es9j-6y5d.json";
// NOLA CFS feed runs ~800 dispatches/day. At the original 5,000-row
// limit the cache spanned only ~6 days; safety-score's annualization
// over 365 days multiplied by 60× and noise was massive. 50k rows
// gives us ~60 days of recent activity, which crosses the 30-day
// "low confidence" trip-wire and produces stable grades across
// refreshes. Socrata accepts $limit up to 50,000 in a single request.
const ROW_LIMIT = 50_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface NolaRow {
  nopd_item?: string;
  type_?: string;
  typetext?: string;
  priority?: string;
  policedistrict?: string;
  beat?: string;
  block_address?: string;
  zip?: string;
  timecreate?: string;
  location?: { type: "Point"; coordinates: [number, number] };
  disposition?: string;
  dispositiontext?: string;
}

// NOPD call type substrings → NIBRS-ish bucketing.
//
// Tightened 2026-05-23: NOPD's CFS feed pulls EVERY dispatched call
// including welfare checks, business checks, alarms, 911 hangups,
// traffic complaints, etc. The earlier mapToNibrs returned SOCIETY
// as the catch-all for any unmatched call, which inflated New
// Orleans' citywide ratio to 13× national. Now we:
//   - Drop CFS-only dispatches explicitly (SKIP_TYPES below)
//   - Match against tighter inclusion lists for PERSONS/PROPERTY
//   - Match an explicit SOCIETY inclusion list (public-order crimes)
//   - Return null for everything else (gets filtered at ingest)
const SKIP_TYPES = [
  "WELFARE CHECK", "BUSINESS CHECK", "ALARM", "ASSIST", "ESCORT",
  "RESPOND TO HEADQUARTERS", "MISSING ADULT", "MISSING JUVENILE",
  "MISSING PERSON", "FOLLOW UP", "MEDICAL", "FIRE", "TRAFFIC",
  "ACCIDENT", "9-1-1", "911", "HANGUP", "ABANDONED",
  "UNCLASSIFIED", "UNKNOWN", "DETAIL", "OFFICER NEEDS",
];
const PERSONS_TYPES = [
  "ASSAULT", "BATTERY", "MURDER", "HOMICIDE", "ROBBERY", "RAPE",
  "SEX OFFENSE", "DOMESTIC VIOL", "DOMESTIC DISTURB", "KIDNAP",
  "AGGRAVATED", "INTIMIDAT", "STALKING",
];
const PROPERTY_TYPES = [
  "THEFT", "BURGLARY", "STOLEN", "VEHICLE THEFT", "AUTO THEFT", "ARSON",
  "VANDALISM", "FRAUD", "FORGERY", "CRIMINAL DAMAGE", "SHOPLIFT",
];
const SOCIETY_TYPES = [
  "DRUG", "NARCOTIC", "WEAPON", "FIREARM", "DISCHARGING",
  "TRESPASS", "DISORDERLY", "DUI", "DWI",
];
function mapToNibrs(row: NolaRow): CrimeCategory | null {
  const t = (row.typetext ?? "").toUpperCase();
  if (SKIP_TYPES.some((k) => t.includes(k))) return null;
  if (PERSONS_TYPES.some((k) => t.includes(k))) return CrimeCategory.PERSONS;
  if (PROPERTY_TYPES.some((k) => t.includes(k))) return CrimeCategory.PROPERTY;
  if (SOCIETY_TYPES.some((k) => t.includes(k))) return CrimeCategory.SOCIETY;
  return null;
}

// ---- Point-in-polygon ------------------------------------------------------

interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = nolaPolygons.map((p) => {
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

function geocodeNola(lng: number, lat: number): string | null {
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
  source: "NOPD Calls for Service 2026 (City of New Orleans Open Data)",
  datasetUrl: "https://data.nola.gov/Public-Safety-and-Preparedness/Calls-for-Service-2026/es9j-6y5d",
  recency: "Live (newest entries minutes old); refreshed continuously by NOPD",
  granularity: "neighborhood",
  disclaimer:
    "Calls dispatched to the New Orleans Police Department, geocoded to one " +
    "of New Orleans' 73 named neighborhoods. Includes non-crime dispatches " +
    "(welfare checks, business checks). CommunitySafe does NOT read NOPD's " +
    "historical incident dataset (qtcu-97s9) because that dataset includes " +
    "offender/victim demographic columns we never display.",
};

function safeIso(raw: string | null | undefined): string {
  if (!raw) return new Date(0).toISOString();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

// NOPD's 8 districts mapped to the single most-recognized
// neighborhood name in each district's geography. Used only as a
// fallback when an incident lacks lat/lng coords (geocodeNola()
// handles the typical case). Replaces the old "District 4" / "District
// 7" labels which were operational shorthand, not neighborhood names.
const NOPD_DISTRICT_TO_NEIGHBORHOOD: Record<string, string> = {
  "1": "Treme",            // 1st: French Quarter / Treme / Marigny
  "2": "Uptown",           // 2nd: Uptown, Garden District, Magazine St
  "3": "Mid-City",         // 3rd: Mid-City, Lakeview
  "4": "Algiers",          // 4th: Algiers / West Bank
  "5": "Bywater",          // 5th: Marigny / Bywater / St. Roch
  "6": "Central City",     // 6th: Garden District / Central City
  "7": "New Orleans East", // 7th: New Orleans East
  "8": "French Quarter",   // 8th: French Quarter / CBD
};
function districtToNeighborhood(raw: string | undefined | null): string {
  if (!raw) return "Unknown";
  return NOPD_DISTRICT_TO_NEIGHBORHOOD[String(raw).trim()] ?? "Unknown";
}

async function fetchNola(): Promise<Incident[]> {
  // Explicit $select — never pull anything we don't render. (Calls for
  // Service 2026 doesn't publish demographics anyway, but belt-and-braces.)
  const select = "nopd_item,type_,typetext,priority,policedistrict,beat,block_address,timecreate,location,disposition,dispositiontext";
  const u = `${BASE}?$limit=${ROW_LIMIT}&$select=${select}&$order=timecreate%20DESC&$where=location%20IS%20NOT%20NULL`;
  const res = await fetch(u, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/CommunitySafe)" },
  });
  if (!res.ok) throw new Error(`NOLA Socrata ${res.status}`);
  const rows = (await res.json()) as NolaRow[];
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // Drop CFS-only dispatches up-front (welfare checks, alarms, etc.)
    // so they never contribute to citywide totals or per-area scores.
    const cat = mapToNibrs(r);
    if (cat === null) continue;
    const c = r.location?.coordinates;
    const lng = Array.isArray(c) ? Number(c[0]) : NaN;
    const lat = Array.isArray(c) ? Number(c[1]) : NaN;
    let area = "Unknown";
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
      area = geocodeNola(lng, lat) ?? districtToNeighborhood(r.policedistrict);
    } else {
      area = districtToNeighborhood(r.policedistrict);
    }
    out.push({
      id: `nola-${r.nopd_item ?? i}`,
      area,
      occurredAt: safeIso(r.timecreate),
      nibrsCategory: cat,
      ibrOffenseDescription: r.typetext?.trim() || r.type_?.trim() || "Unknown",
      beat: r.beat ?? null,
      blockLabel: r.block_address ?? undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lng) && lng !== 0 ? lng : undefined,
    });
  }
  return out;
}

export async function getRowsNola(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchNola();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[nola] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasNola(): Promise<KnownArea[]> {
  const rows = await getRowsNola();
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
    .map(([name, e]) => ({
      slug: `nola-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "New Orleans",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForNolaSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("nola-") ? s.slice(5) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const nolaAdapter: CrimeDataAdapter = {
  name: "nola-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsNola();
    const label = labelForNolaSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 300 ? 5 : inArea.length > 160 ? 4 : inArea.length > 80 ? 3 : inArea.length > 30 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsNola();
    const label = labelForNolaSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },

  async getRecentReports(area: string, opts?: { limit?: number }) {
    return this.getIncidents(area, { limit: opts?.limit ?? 20 });
  },
};
