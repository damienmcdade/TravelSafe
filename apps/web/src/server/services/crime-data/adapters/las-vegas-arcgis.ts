import "server-only";
import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";
import { lasVegasPolygons } from "../../../data/las-vegas-neighborhoods";

// Las Vegas — Las Vegas Metropolitan Police Department Calls for Service.
// ArcGIS FeatureServer on services1.arcgis.com (owner: Opendata_lasvegas).
//
// IMPORTANT NOTES on this dataset:
// 1. It is dispatched CFS, not closed crime reports. The feed is dominated
//    by administrative entries (404 UNKNOWN TROUBLE, 439 ASSIST CITIZEN,
//    425 SUSPICIOUS PERSON/VEHICLE, 401 TRAFFIC ACCIDENTS, alarms). We
//    filter aggressively at ingest so the per-neighborhood mix represents
//    actual reported offenses, not patrol activity.
// 2. We DO NOT keep entries that describe people in ambiguous terms
//    ("suspicious person", "unhoused disturbance") — these are not
//    confirmed crimes and including them would misrepresent neighborhoods.
// 3. LAT/LONG come through as strings — parse defensively.
// 4. Neighborhood is geocoded via PIP through 26 named Las Vegas polygons
//    (blackmad/neighborhoods) since LVMPD only publishes a 6-ward grid.

const BASE = "https://services1.arcgis.com/F1v0ufATbBQScMtY/arcgis/rest/services/MetroCFS_OpenData/FeatureServer/0/query";
const PAGE_SIZE = 2000;
// v26 bump 5 → 15. Las Vegas CFS at 0.50 scale was running 2.4×
// over on PERSONS (suggesting too few rows / annualization
// inflation) — deeper cache reduces that.
const PAGES = 15;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface LvRow {
  Event_Number?: string;
  Event_Date?: string;
  Type?: string;
  Type_Description?: string;
  General_Location?: string;
  Beat?: string;
  Disposition?: string;
  LAT?: string;
  LONG?: string;
  WARD?: string;
}

// Keyword groups — keep ONLY rows that name an actual offense.
//
// Tightened 2026-05-23: dropped MISSING PERSON (not a NIBRS offense
// category — usually administrative), HIT AND RUN (vehicle code, not
// NIBRS property), and the bare INTOX/DRUNK (often paired with welfare
// dispatch, not necessarily a public-intox offense). Also broadened
// SKIP_KEYS to drop more dispatch-only categories so LV's citywide
// ratio reflects actual crime reports, not total CAD events.
const PERSONS_KEYS = [
  "ASSAULT", "BATTERY", "HOMICIDE", "MURDER", "ROBBERY",
  "KIDNAP", "ABDUCT", "SEX OFFENSE", "SEX CRIME", "RAPE",
  "FAMILY DISTURBANCE", "DOMESTIC", "THREATEN", "INTIMIDATE",
];
const PROPERTY_KEYS = [
  "LARCENY", "THEFT", "AUTO THEFT", "STOLEN", "BURGLARY",
  "VANDAL", "DAMAGE", "ARSON", "FRAUD", "FORGERY",
  "EMBEZZLE", "SHOPLIFT",
];
const SOCIETY_KEYS = [
  "DRUG", "NARCOTIC", "WEAPON", "FIREARM", "DISCHARGING",
  "PROSTITUTION", "TRESPASS", "DISORDERLY CONDUCT", "DUI",
];
// Anything mentioning these is dropped at ingest — administrative
// dispatches or non-crime calls that would over-count "incidents"
// relative to NIBRS-only city feeds.
const SKIP_KEYS = [
  "ALARM", "ASSIST", "INFO", "SUSPICIOUS", "UNKNOWN TROUBLE",
  "9-1-1 DISCONNECT", "ACCIDENT", "TRAFFIC PROBLEM",
  "CIVIL MATTER", "BROADCAST", "RECKLESS DRIVER", "UNHOUSED",
  "SPECIAL ATTENTION", "FOLLOW UP", "DETAIL", "PARK, WALK",
  "WELFARE", "CHECK", "OFFICER INITIATED", "MISSING",
  "HIT AND RUN", "SHOTS FIRED", "FOUND PROPERTY", "LOST",
  "MENTAL HEALTH", "INTOX",
];

function classify(desc: string): CrimeCategory | null {
  const t = desc.toUpperCase();
  for (const k of SKIP_KEYS) if (t.includes(k)) return null;
  if (PERSONS_KEYS.some((k) => t.includes(k))) return CrimeCategory.PERSONS;
  if (PROPERTY_KEYS.some((k) => t.includes(k))) return CrimeCategory.PROPERTY;
  if (SOCIETY_KEYS.some((k) => t.includes(k))) return CrimeCategory.SOCIETY;
  return null;
}

// ---- Point-in-polygon ------------------------------------------------------

interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = lasVegasPolygons.map((p) => {
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

function geocodeLasVegas(lng: number, lat: number): string | null {
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
  source: "Las Vegas Metropolitan Police Department Calls for Service (Opendata Las Vegas, ArcGIS Feature Server)",
  datasetUrl: "https://opendata-lasvegas.opendata.arcgis.com/",
  recency: "Refreshed near-daily by LVMPD; data ~3 weeks behind real time",
  granularity: "neighborhood",
  disclaimer:
    "These are LVMPD dispatched calls for service rather than closed NIBRS " +
    "reports. CommunitySafe drops administrative dispatches (traffic stops, alarms, " +
    "follow-ups, assist calls, suspicious-person calls, unhoused-disturbance " +
    "entries) at ingest and only keeps rows that name an actual reported " +
    "offense. Some incidents may later be reclassified or unfounded by LVMPD " +
    "investigators.",
};

async function fetchPage(offset: number): Promise<LvRow[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", "LAT IS NOT NULL AND LAT <> ''");
  url.searchParams.set("outFields", "Event_Number,Event_Date,Type,Type_Description,General_Location,Beat,Disposition,LAT,LONG,WARD");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "Event_Date DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("f", "json");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/CommunitySafe)" },
  });
  if (!res.ok) throw new Error(`Las Vegas ArcGIS ${res.status} offset=${offset}`);
  const body = await res.json() as { features?: Array<{ attributes: LvRow }> };
  return (body.features ?? []).map((f) => f.attributes);
}

async function fetchLasVegas(): Promise<Incident[]> {
  const pages = await Promise.all(
    Array.from({ length: PAGES }, (_, i) => fetchPage(i * PAGE_SIZE).catch(() => [] as LvRow[])),
  );
  const rows = pages.flat();
  const out: Incident[] = [];
  for (const r of rows) {
    const desc = r.Type_Description?.trim() ?? "";
    const cat = classify(desc);
    if (cat == null) continue;
    const lat = Number(r.LAT);
    const lng = Number(r.LONG);
    let area = "Unknown";
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
      area = geocodeLasVegas(lng, lat) ?? "Unknown";
    }
    if (area === "Unknown") continue;
    out.push({
      id: `lv-${r.Event_Number ?? out.length}`,
      area,
      occurredAt: r.Event_Date ? new Date(r.Event_Date.replace(" ", "T")).toISOString() : new Date(0).toISOString(),
      nibrsCategory: cat,
      ibrOffenseDescription: desc,
      beat: r.Beat ?? (r.WARD ? `Ward ${r.WARD}` : null),
      blockLabel: undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lng) && lng !== 0 ? lng : undefined,
    });
  }
  return out;
}

export async function getRowsLasVegas(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchLasVegas();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[lv] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasLasVegas(): Promise<KnownArea[]> {
  const rows = await getRowsLasVegas();
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
      slug: `lv-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Las Vegas",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForLasVegasSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("lv-") ? s.slice(3) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const lasVegasAdapter: CrimeDataAdapter = {
  name: "las-vegas-arcgis",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsLasVegas();
    const label = labelForLasVegasSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 500 ? 5 : inArea.length > 250 ? 4 : inArea.length > 100 ? 3 : inArea.length > 30 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsLasVegas();
    const label = labelForLasVegasSlug(area, rows);
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
