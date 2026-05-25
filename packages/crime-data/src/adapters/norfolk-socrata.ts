import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";

// Norfolk VA — Norfolk Police Incident Reports on data.norfolk.gov
// (Socrata dataset r7bn-2egr). Replaces Tucson in the supported-city
// list because Tucson's only published feed is a rolling Last-45-Days
// layer with no historical alternative; Norfolk publishes a full
// 108k-incident dataset with daily updates, neighborhood labels, and
// zone + district + Census tract granularity.
//
// Norfolk does NOT publish per-row lat/lng on this dataset — only
// streetno/street pairs. Discovery uses the city's centroid as the
// per-area centroid, which the safety-score's polygon-area / peer-
// share fallback handles fine.

const BASE = "https://data.norfolk.gov/resource/r7bn-2egr.json";
const ROW_LIMIT = 50_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface NorRow {
  inci_id?: string;
  offense?: string;
  streetno?: string | number;
  street?: string;
  date_occu?: string;
  hour_occu?: number | string;
  tract?: string;
  zone?: string;
  district?: string;
  reportarea?: string;
  dow1?: string;
  neighborhd?: string;
}

// Norfolk publishes the offense as a free-text string (e.g., "SHOOT
// INTO OCCUPIED VEHICLE", "LARCENY-PETIT", "GRAFFITI"). Map keyword
// groups to our 3-bucket NIBRS taxonomy. The safety-score's UCR
// Part 1 filter runs on top of this, narrowing to the FBI-published
// rate categories.
const PERSONS_KEYS = [
  "ASSAULT", "BATTERY", "MURDER", "HOMICIDE", "KIDNAP", "ABDUCT",
  "RAPE", "SEX OFFENSE", "SEXUAL", "ROBBERY", "CARJACK",
  "SHOOT INTO", "SHOOTING", "STAB", "STRANGLE", "INTIMIDATION",
  "HARASSMENT", "MENACING", "THREAT", "DOMESTIC", "STALKING",
];
const PROPERTY_KEYS = [
  "BURGLARY", "LARCENY", "THEFT", "STEAL", "STOLEN", "SHOPLIFT",
  "ARSON", "VANDALISM", "DAMAGE", "GRAFFITI", "TRESPASS",
  "BREAKING", "B&E", "BREAK AND ENTER", "FRAUD", "FORGERY",
  "EMBEZZLE", "COUNTERFEIT", "MOTOR VEH", "VEHICLE", "AUTO",
];

function mapToNibrs(row: NorRow): CrimeCategory {
  const t = (row.offense ?? "").toUpperCase();
  if (PERSONS_KEYS.some((k) => t.includes(k))) return CrimeCategory.PERSONS;
  if (PROPERTY_KEYS.some((k) => t.includes(k))) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "Norfolk Police Incident Reports (data.norfolk.gov, Socrata)",
  datasetUrl: "https://data.norfolk.gov/Public-Safety/Police-Incident-Reports/r7bn-2egr",
  recency: "Refreshed daily by NPD",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Norfolk Police Department and aggregated " +
    "to one of ~50 named Norfolk neighborhoods (the city's published " +
    "Civic League boundaries). Block-level addresses only; per-incident " +
    "lat/lng is not published — discovery uses the city centroid as a " +
    "placeholder. CommunitySafe does not request demographic columns.",
};

function safeIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime()) || d.getTime() <= 0) return null;
  return d.toISOString();
}

// Norfolk centroid (lat 36.85, lng -76.28). Used as a per-area
// placeholder until/unless we add real polygon geocoding for the
// city's Civic League neighborhoods.
const NORFOLK_CENTROID = { lat: 36.85, lng: -76.28 };

// Norfolk's open-data feed publishes neighborhood names in ALLCAPS
// ("GHENT", "OCEAN VIEW", "DOWNTOWN"). Title-case them at ingest so
// every downstream surface (wheel picker, ThreatFeed, hotspots,
// search) reads "Ghent" / "Ocean View" / "Downtown" instead. Small
// words ("of", "the", "and") stay lowercase unless they're the first
// word. Common acronyms (BRT, NSU) get re-capitalized.
const ACRONYMS = new Set(["BRT", "NSU", "ODU", "EVMS", "HRT"]);
const SMALL_WORDS = new Set(["of", "the", "and", "at", "in", "on", "by", "for"]);
function titleCaseArea(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => {
      const upper = w.toUpperCase();
      if (ACRONYMS.has(upper)) return upper;
      if (i > 0 && SMALL_WORDS.has(w)) return w;
      // Handle hyphenated words ("park-place" → "Park-Place") and
      // apostrophes ("o'brien" → "O'Brien").
      return w.replace(/(^|[-'])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
    })
    .join(" ");
}

async function fetchNorfolk(): Promise<Incident[]> {
  const select = "inci_id,offense,streetno,street,date_occu,hour_occu,tract,zone,district,reportarea,dow1,neighborhd";
  const u = `${BASE}?$limit=${ROW_LIMIT}&$select=${select}&$order=date_occu%20DESC&$where=date_occu%20IS%20NOT%20NULL%20AND%20neighborhd%20IS%20NOT%20NULL`;
  const res = await fetch(u, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/CommunitySafe)" },
  });
  if (!res.ok) throw new Error(`Norfolk Socrata ${res.status}`);
  const rows = (await res.json()) as NorRow[];
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const occurredAt = safeIso(r.date_occu);
    if (!occurredAt) continue;
    const area = titleCaseArea(r.neighborhd?.trim());
    if (!area || area.toUpperCase() === "UNKNOWN") continue;
    out.push({
      id: `nor-${r.inci_id ?? i}`,
      area,
      occurredAt,
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.offense?.trim() || "Unknown",
      beat: r.zone ?? r.district ?? null,
      blockLabel: undefined,
      lat: NORFOLK_CENTROID.lat,
      lng: NORFOLK_CENTROID.lng,
    });
  }
  return out;
}

export async function getRowsNorfolk(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchNorfolk();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[norfolk] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasNorfolk(): Promise<KnownArea[]> {
  const rows = await getRowsNorfolk();
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    counts.set(r.area, (counts.get(r.area) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, n]) => n >= 3)
    .map(([name]) => ({
      slug: `nor-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Norfolk",
      centroid: NORFOLK_CENTROID,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForNorfolkSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("nor-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const norfolkAdapter: CrimeDataAdapter = {
  name: "norfolk-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsNorfolk();
    const label = labelForNorfolkSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 1500 ? 5 : inArea.length > 800 ? 4 : inArea.length > 400 ? 3 : inArea.length > 150 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsNorfolk();
    const label = labelForNorfolkSlug(area, rows);
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
