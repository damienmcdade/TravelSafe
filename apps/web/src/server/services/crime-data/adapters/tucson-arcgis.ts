import "server-only";
import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";
import { tucsonPolygons } from "../../../data/tucson-neighborhoods";

// Tucson — Tucson Police Department Incidents - Last 45 Days.
// ArcGIS MapServer on gis.tucsonaz.gov.
//
// TPD publishes a rolling-45-day public feed with `STATUTDESC` (clear
// offense names like "Larceny - From Motor Vehicle", "Aggravated Assault
// - Domestic Violence", "Narcotic Drug Laws - Possession") and a
// NHA_NAME field naming the active Tucson neighborhood association
// for the incident.
//
// Limitations to be honest about:
//   * NHA_NAME is only populated for ~60% of records (the ones inside
//     an active city-recognized neighborhood association). The adapter
//     drops the rest at intake so the map only shows neighborhoods
//     TPD has labeled — not unclassified records.
//   * The feed is rolling 45 days so historical trends aren't possible.
//   * Some non-crime entries appear ("Public Assist - Check Welfare",
//     "Mental Health - Transported"). We filter those out at ingest.

const BASE = "https://gis.tucsonaz.gov/public/rest/services/PublicMaps/PublicSafety/MapServer/49/query";
const PAGE_SIZE = 2000;
const PAGES = 5;                 // 10k rows is more than 45 days produces
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface TucsonRow {
  INCI_ID?: string;
  DATETIME_REPT?: number;
  DATE_REPT?: number;
  NEIGHBORHD?: string;
  NHA_NAME?: string;
  WARD?: string;
  DIVISION?: string;
  OFFENSE?: string;
  STATUTDESC?: string;
  ADDRESS_PUBLIC?: string;
}

const PERSONS_KEYS = [
  "ASSAULT", "AGGRAVATED ASSAULT", "HOMICIDE", "MURDER",
  "KIDNAP", "ABDUCT", "RAPE", "SEX OFFENSE",
  "DOMESTIC VIOLENCE", "INTIMIDATE", "THREATEN",
];
const PROPERTY_KEYS = [
  "LARCENY", "THEFT", "BURGLARY", "MOTOR VEHICLE THEFT",
  "STOLEN", "ARSON", "ROBBERY", "FORGERY", "FRAUD",
  "EMBEZZLE", "COUNTERFEIT", "CRIMINAL DAMAGE", "VANDAL",
  "SHOPLIFT",
];
const SOCIETY_KEYS = [
  "NARCOTIC", "DRUG", "WEAPON", "TRESPASS", "DISORDERLY",
  "DRIVING UNDER", "DUI", "PROSTITUTION", "LIQUOR",
];
// Drop administrative entries — TPD records mental-health transports,
// welfare checks, found property, traffic accidents, "miscellaneous" etc.
// in the same feed. Excluding them keeps per-neighborhood counts
// comparable to NIBRS-only feeds.
const SKIP_KEYS = [
  "PUBLIC ASSIST", "CHECK WELFARE", "MENTAL HEALTH", "MISCELLANEOUS",
  "FOUND -", "LOST -", "CIVIL MATTER", "TRAFFIC ACCIDENT",
  "SUSPICIOUS ACTIVTY", "SUSPICIOUS ACTIVITY", "OTHER MISDEMEANORS",
  "DEATH -", "OTHER OFFENSES",
];

function classify(desc: string): CrimeCategory | null {
  const t = desc.toUpperCase();
  for (const k of SKIP_KEYS) if (t.includes(k)) return null;
  if (PERSONS_KEYS.some((k) => t.includes(k))) return CrimeCategory.PERSONS;
  if (PROPERTY_KEYS.some((k) => t.includes(k))) return CrimeCategory.PROPERTY;
  if (SOCIETY_KEYS.some((k) => t.includes(k))) return CrimeCategory.SOCIETY;
  return null;
}

// PIP for the ~40% of records that have lat/lng but no NHA_NAME.
interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = tucsonPolygons.map((p) => {
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

function geocodeTucson(lng: number, lat: number): string | null {
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
  source: "Tucson Police Incidents — Last 45 Days (City of Tucson Open Data, ArcGIS MapServer)",
  datasetUrl: "https://gisdata.tucsonaz.gov/datasets/cotgis::tucson-police-incidents-last-45-days-open-data",
  recency: "Rolling 45-day window, refreshed daily by TPD",
  granularity: "neighborhood",
  disclaimer:
    "TPD publishes a 45-day rolling window of incidents tagged with the " +
    "Tucson neighborhood association (NHA) name where applicable. About 40% " +
    "of records fall outside a recognized NHA — TravelSafe geocodes those " +
    "via the city's neighborhood polygon dataset if possible, else drops " +
    "them. Administrative entries (welfare checks, mental-health transports, " +
    "found/lost property, traffic accidents) are filtered out at ingest.",
};

async function fetchPage(offset: number): Promise<Array<{ attributes: TucsonRow; geometry?: { x?: number; y?: number } }>> {
  const url = new URL(BASE);
  url.searchParams.set("where", "DATETIME_REPT IS NOT NULL");
  url.searchParams.set("outFields", "INCI_ID,DATETIME_REPT,DATE_REPT,NEIGHBORHD,NHA_NAME,WARD,DIVISION,OFFENSE,STATUTDESC,ADDRESS_PUBLIC");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("orderByFields", "DATETIME_REPT DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("f", "json");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "TravelSafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
  });
  if (!res.ok) throw new Error(`Tucson ArcGIS ${res.status} offset=${offset}`);
  const body = await res.json() as { features?: Array<{ attributes: TucsonRow; geometry?: { x?: number; y?: number } }> };
  return body.features ?? [];
}

async function fetchTucson(): Promise<Incident[]> {
  const pages = await Promise.all(
    Array.from({ length: PAGES }, (_, i) => fetchPage(i * PAGE_SIZE).catch(() => [] as Awaited<ReturnType<typeof fetchPage>>)),
  );
  const features = pages.flat();
  const out: Incident[] = [];
  for (const feat of features) {
    const r = feat.attributes;
    const desc = r.STATUTDESC?.trim() ?? "";
    const cat = classify(desc);
    if (cat == null) continue;
    const lat = feat.geometry?.y;
    const lng = feat.geometry?.x;
    // Area resolution: prefer TPD's published NHA_NAME, else PIP via lat/lng.
    let area: string = (r.NHA_NAME ?? "").trim();
    if (!area && typeof lat === "number" && typeof lng === "number" && lat !== 0 && lng !== 0) {
      area = geocodeTucson(lng, lat) ?? "";
    }
    if (!area) continue;
    out.push({
      id: `tuc-${r.INCI_ID ?? out.length}`,
      area,
      occurredAt: r.DATETIME_REPT ? new Date(r.DATETIME_REPT).toISOString()
                : r.DATE_REPT ? new Date(r.DATE_REPT).toISOString()
                : new Date(0).toISOString(),
      nibrsCategory: cat,
      ibrOffenseDescription: desc,
      beat: r.DIVISION ? r.DIVISION.replace(/^Operations Division\s+/, "") : (r.WARD ? `Ward ${r.WARD}` : null),
      blockLabel: r.ADDRESS_PUBLIC ?? undefined,
      lat: typeof lat === "number" && lat !== 0 ? lat : undefined,
      lng: typeof lng === "number" && lng !== 0 ? lng : undefined,
    });
  }
  return out;
}

export async function getRowsTucson(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchTucson();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[tuc] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasTucson(): Promise<KnownArea[]> {
  const rows = await getRowsTucson();
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
      slug: `tuc-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Tucson",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForTucsonSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("tuc-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const tucsonAdapter: CrimeDataAdapter = {
  name: "tucson-arcgis",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsTucson();
    const label = labelForTucsonSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 200 ? 5 : inArea.length > 100 ? 4 : inArea.length > 50 ? 3 : inArea.length > 15 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsTucson();
    const label = labelForTucsonSlug(area, rows);
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
