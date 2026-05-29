import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import type { KnownArea } from "../neighborhoods.js";
import { fetchSocrata, socrataDate } from "../lib/http.js";

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
// v70 — paired O(1) indexes (slug→label, label→rows) built once
// per cache load. Same pattern as Detroit + KC (v69 followup-2/3).
// Norfolk has 122 areas; without the index, getIncidents per area
// runs O(n_areas × n_rows) string ops per warm cycle.
interface Cache {
  fetchedAt: number;
  rows: Incident[];
  slugToLabel: Map<string, string>;
  labelToRows: Map<string, Incident[]>;
}
let cache: Cache | null = null;
function buildNorfolkIndexes(rows: Incident[]): Pick<Cache, "slugToLabel" | "labelToRows"> {
  const slugToLabel = new Map<string, string>();
  const labelToRows = new Map<string, Incident[]>();
  for (const r of rows) {
    const label = r.area;
    if (!label) continue;
    let bucket = labelToRows.get(label);
    if (!bucket) { bucket = []; labelToRows.set(label, bucket); }
    bucket.push(r);
    if (!slugToLabel.has(label)) {
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      slugToLabel.set(slug, label);
    }
  }
  return { slugToLabel, labelToRows };
}

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
    "placeholder. TravelSafe does not request demographic columns.",
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
  // v96 — migrated to fetchSocrata helper.
  // v96p2 — added 180-d cutoff to match seattle/dallas/sf/nola/kc/chicago.
  const cutoff = socrataDate(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const rows = await fetchSocrata<NorRow>("Norfolk Socrata", {
    url: BASE,
    select: "inci_id,offense,streetno,street,date_occu,hour_occu,tract,zone,district,reportarea,dow1,neighborhd",
    where: `date_occu IS NOT NULL AND neighborhd IS NOT NULL AND date_occu >= '${cutoff}'`,
    order: "date_occu DESC",
    limit: ROW_LIMIT,
  });
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

// v94 — in-flight Promise dedup (see detroit-arcgis.ts for rationale).
let inFlightNorFetch: Promise<Incident[]> | null = null;

export async function getRowsNorfolk(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightNorFetch) return inFlightNorFetch;
  inFlightNorFetch = (async () => {
    try {
      const rows = await fetchNorfolk();
      if (rows.length > 0) {
        const idx = buildNorfolkIndexes(rows);
        cache = { fetchedAt: now, rows, ...idx };
      }
      return rows;
    } catch (err) {
      console.warn("[norfolk] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightNorFetch = null;
    }
  })();
  return inFlightNorFetch;
}

export async function getDiscoveredAreasNorfolk(): Promise<KnownArea[]> {
  const rows = await getRowsNorfolk();
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    counts.set(r.area, (counts.get(r.area) ?? 0) + 1);
  }
  // Drop entries whose name produces an empty slug body (e.g.,
  // rows where neighborhd is "." or other punctuation-only — Norfolk's
  // feed has a handful that survived the IS NOT NULL filter).
  // Bug surfaced in v42 e2e sweep as {slug:"nor-",label:"."} in
  // /api/geo/areas.
  return Array.from(counts.entries())
    .filter(([, n]) => n >= 3)
    .map(([name]) => {
      const slugBody = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      return {
        slug: `nor-${slugBody}`,
        label: name,
        jurisdiction: "Norfolk",
        centroid: NORFOLK_CENTROID,
        _slugBody: slugBody,
      };
    })
    .filter((a) => a._slugBody.length > 0)
    .map(({ _slugBody, ...rest }) => { void _slugBody; return rest; })
    .sort((a, b) => a.label.localeCompare(b.label));
}

// v70 — O(1) Map lookup. Pre-v70 this scanned every row in the
// adapter on every call (122 areas × ~40k rows = ~5M ops per warm).
function labelForNorfolkSlug(slug: string): string | null {
  if (!cache) return null;
  const s = slug.toLowerCase();
  const want = s.startsWith("nor-") ? s.slice(4) : s;
  return cache.slugToLabel.get(want) ?? null;
}

export const norfolkAdapter: CrimeDataAdapter = {
  name: "norfolk-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    await getRowsNorfolk();
    const label = labelForNorfolkSlug(area);
    if (!label) return null;
    const inArea = cache?.labelToRows.get(label) ?? [];
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 1500 ? 5 : inArea.length > 800 ? 4 : inArea.length > 400 ? 3 : inArea.length > 150 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    await getRowsNorfolk();
    const label = labelForNorfolkSlug(area);
    if (!label) return [];
    let filtered = cache?.labelToRows.get(label) ?? [];
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    const sorted = [...filtered].sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return sorted.slice(0, opts?.limit ?? 50);
  },

  async getRecentReports(area: string, opts?: { limit?: number }) {
    return this.getIncidents(area, { limit: opts?.limit ?? 20 });
  },
};
