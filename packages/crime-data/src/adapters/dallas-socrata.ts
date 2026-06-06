import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { fetchSocrata } from "../lib/http.js";
import { dallasPolygons } from "../data/dallas-neighborhoods.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";

// Dallas TX — DPD Police Incidents.
// Socrata dataset qv6i-rri7 on www.dallasopendata.com. Refreshed daily.
//
// Two important shape notes:
// 1. The upstream dataset carries demographic columns (`comprace`,
//    `compethnicity`, `compsex`). The adapter NEVER requests them — every
//    fetch uses an explicit $select that omits those fields entirely.
// 2. Dallas tags rows with `sector` codes ("310", "430", …) which are
//    granular but not user-readable. We geocode the lat/lng through 24
//    named Dallas neighborhood polygons at intake so the area surfaces as
//    "Downtown" or "Oak Lawn" rather than "310".

const BASE = "https://www.dallasopendata.com/resource/qv6i-rri7.json";
// v26 bump 5k → 30k. Dallas was under-counting PERSONS by 2.2×
// against FBI; 5k rows only covered ~3 weeks of DPD volume.
const ROW_LIMIT = 30_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; }, "dallas-socrata");

interface DallasRow {
  incidentnum?: string;
  servnumid?: string;
  offincident?: string;
  date1?: string;
  reporteddate?: string;
  division?: string;
  sector?: string;
  beat?: string;
  district?: string;
  nibrs_crime?: string;
  nibrs_crime_category?: string;
  nibrs_crimeagainst?: string;
  geocoded_column?: { latitude?: string; longitude?: string };
}

function mapToNibrs(row: DallasRow): CrimeCategory {
  // v99 — Dallas's NIBRS feed tags ROBBERY with crimeagainst="PROPERTY",
  // but FBI UCR Part-1 counts robbery as VIOLENT. Trusting the upstream
  // tag routed ~771 robberies/180d into PROPERTY, simultaneously pushing
  // the citywide violent rate to 0.38x FBI (robberies missing from PERSONS)
  // and property to 1.41x (robberies added to PROPERTY). Force robbery into
  // PERSONS so both rates line up with the FBI baseline.
  const offense = (row.nibrs_crime || row.offincident || "").toUpperCase();
  if (/\bROBBERY\b/.test(offense)) return CrimeCategory.PERSONS;
  const c = (row.nibrs_crimeagainst ?? "").trim().toUpperCase();
  if (c === "PERSON" || c === "PERSONS") return CrimeCategory.PERSONS;
  if (c === "PROPERTY") return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// ---- Point-in-polygon ------------------------------------------------------

interface PolyIndex { name: string; bbox: [number, number, number, number]; rings: number[][][] }
const POLY_INDEX: PolyIndex[] = dallasPolygons.map((p) => {
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

function geocodeDallas(lng: number, lat: number): string | null {
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
  source: "Dallas Police Incidents (City of Dallas Open Data)",
  datasetUrl: "https://www.dallasopendata.com/Public-Safety/Police-Incidents/qv6i-rri7",
  recency: "Refreshed daily by DPD",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Dallas Police Department and geocoded by " +
    "CommunitySafe to a named neighborhood using city-published polygons. CommunitySafe " +
    "explicitly excludes the suspect / complainant demographic columns published " +
    "by DPD from every request.",
};

function safeIso(raw: string | null | undefined): string {
  if (!raw) return new Date(0).toISOString();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

// Per-word title-case for DPD division names that arrive ALLCAPS
// ("SOUTH CENTRAL", "NORTHEAST", "NORTH CENTRAL"). Handles hyphens
// and apostrophes the same way the Norfolk title-caser does so
// names like "O'Connell" / "Park-View" capitalize cleanly.
function titleCaseDivision(raw: string): string {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/(^|[-'])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase()))
    .join(" ");
}

async function fetchDallas(): Promise<Incident[]> {
  // v96 — migrated to fetchSocrata helper (was a hand-built template-
  // string URL; the audit also flagged this for future $where
  // expansion risk if conditions grew. The helper handles encoding.)
  // EXPLICIT $select — never request demographic columns.
  // v96p2 — 180-day recent window per the deployment-log scan.
  const rows = await fetchSocrata<DallasRow>("Dallas Socrata", {
    url: BASE,
    select: "incidentnum,servnumid,offincident,date1,division,sector,beat,nibrs_crime,nibrs_crime_category,nibrs_crimeagainst,geocoded_column",
    where: "date1 IS NOT NULL AND geocoded_column IS NOT NULL",
    windowDays: 180,
    dateField: "date1",
    order: "date1 DESC",
    limit: ROW_LIMIT,
  });
  return rows.map((r, i) => {
    const lat = Number(r.geocoded_column?.latitude);
    const lng = Number(r.geocoded_column?.longitude);
    let area = "Unknown";
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
      // Fallback when point-in-polygon misses: DPD division name +
      // "Dallas". Divisions arrive ALLCAPS ("CENTRAL", "SOUTH CENTRAL",
      // "NORTHEAST"). The prior `r.division[0] + r.division.slice(1).
      // toLowerCase()` only capitalized the FIRST char, so "SOUTH
      // CENTRAL" became "South central Dallas" with a stranded lower-
      // case "c". Per-word title-case fixes it: "South Central Dallas".
      area = geocodeDallas(lng, lat) ?? "Unmapped"; // v102: was DPD-division fallback (not a neighborhood); collapse off-polygon incidents into Unmapped
    }
    return {
      id: `dal-${r.servnumid ?? r.incidentnum ?? i}`,
      area,
      occurredAt: safeIso(r.date1),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: titleCaseOffense(r.nibrs_crime || r.offincident),
      beat: r.beat ?? r.sector ?? null,
      blockLabel: undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lng) && lng !== 0 ? lng : undefined,
    };
  });
}

// v107 — in-flight fetch dedup (the OOM-guard Detroit added in v94): the
// dispatcher fans a per-area Promise.all over every neighbourhood, so a cold
// cache previously fired N concurrent full fetches. Concurrent callers now
// await the same promise.
let inFlightDallasFetch: Promise<Incident[]> | null = null;
export async function getRowsDallas(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightDallasFetch) return inFlightDallasFetch;
  inFlightDallasFetch = (async () => {
    try {
      const rows = await fetchDallas();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[dal] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightDallasFetch = null;
    }
  })();
  return inFlightDallasFetch;
}

export async function getDiscoveredAreasDallas(): Promise<KnownArea[]> {
  const rows = await getRowsDallas();
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
      slug: `dal-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Dallas",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForDallasSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("dal-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const dallasAdapter: CrimeDataAdapter = {
  name: "dallas-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsDallas();
    const label = labelForDallasSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [30, 80, 160, 300]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsDallas();
    const label = labelForDallasSlug(area, rows);
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
