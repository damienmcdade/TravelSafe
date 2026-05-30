import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { bucketByBands, deriveBands } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { fetchSocrata } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";
// v95p7 — switched from runtime fs.readFileSync to a static JSON import.
// The fs/path/url imports tripped Next's webpack edge-bundling for
// opengraph-image.tsx ("UnhandledSchemeError: node:url"), failing the
// last 2 Vercel deploys. Static imports work in both Node + edge AND
// give the same data at zero runtime cost. The JSON is checked in
// (geocoder script writes to the same path) and the package build
// copies src/data/*.json → dist/data/ so the file ships alongside.
import GEOCODE_RAW from "../data/honolulu-blockaddress-neighborhood.json" with { type: "json" };

// Honolulu — Honolulu Police Department incidents published on
// data.honolulu.gov (Socrata dataset vg88-5rn5). The feed publishes
// blockaddress + offense type but does NOT publish per-incident
// lat/lng OR neighborhood.
//
// v95p4 — per-neighborhood granularity via offline geocoded cache.
// tools/geocode-honolulu.mjs reverse-geocodes every unique
// blockaddress through OSM Nominatim (~85 min wall-clock one-time)
// and writes data/honolulu-blockaddress-neighborhood.json mapping
// each address to its OSM-resolved suburb / hamlet / city_district
// label. The adapter loads that JSON at startup and assigns each
// incident to its named Honolulu neighborhood (Waikiki, Kalihi,
// Manoa, Waimalu, etc.). Addresses not in the map fall through to
// a single citywide bucket "Honolulu" so the safety-score and
// citywide endpoints never drop rows silently.

const BASE = "https://data.honolulu.gov/resource/vg88-5rn5.json";
const ROW_LIMIT = 50_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface Cache {
  fetchedAt: number;
  rows: Incident[];
  slugToLabel: Map<string, string>;
  labelToRows: Map<string, Incident[]>;
}
let cache: Cache | null = null;
registerRowCache(() => { cache = null; });

interface HnlRow {
  objectid?: string;
  incidentnum?: string;
  blockaddress?: string;
  date?: string;
  type?: string;
  status?: string;
}

interface GeocodedEntry {
  neighborhood: string;
  lat: number;
  lng: number;
}
interface GeocodeJson {
  generatedAt?: string;
  addressCount?: number;
  neighborhoodCount?: number;
  neighborhoods?: Array<{ name: string; count: number; centroid: { lat: number; lng: number } }>;
  addresses?: Record<string, GeocodedEntry>;
}

const GEOCODE_MAP = GEOCODE_RAW as GeocodeJson;

const HONOLULU_CENTROID = { lat: 21.3099, lng: -157.8581 };

// Slug a neighborhood label down to the URL-safe area key.
// "Waikīkī" → "waikiki" (strip diacritics first).
function slugify(label: string): string {
  return label
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Resolve a blockaddress to its cached neighborhood label. Returns
// "Honolulu" (citywide bucket) when the address isn't in the map,
// so the row still contributes to citywide aggregates instead of
// being dropped.
function resolveNeighborhood(blockaddress: string | undefined): { label: string; lat: number; lng: number } {
  if (!blockaddress) return { label: "Honolulu", ...HONOLULU_CENTROID };
  const hit = GEOCODE_MAP.addresses?.[blockaddress.trim()];
  if (hit) return { label: hit.neighborhood, lat: hit.lat, lng: hit.lng };
  return { label: "Honolulu", ...HONOLULU_CENTROID };
}

// HPD types are short and stable. Map them to the 3-bucket NIBRS
// taxonomy so the safety-score Part-1 filter can score them.
const PERSONS_TYPES = new Set([
  // v99 — "WEAPONS" removed: weapon-law violations are NIBRS Crimes Against
  // Society, never UCR Part-1 violent. Bucketing them as PERSONS added ~212
  // phantom violent counts, inflating Honolulu's PERSONS rate (was 1.94x FBI).
  // (HPD's coarse single "ASSAULT" bucket — Assault 1/2/3 combined, dominated
  // by misdemeanor Assault-3 — remains a known over-count the feed can't
  // disambiguate without subtype data.)
  "ASSAULT", "ROBBERY", "HOMICIDE", "SEX CRIMES",
]);
const PROPERTY_TYPES = new Set([
  "THEFT/LARCENY", "VANDALISM", "MOTOR VEHICLE THEFT",
  "VEHICLE BREAK-IN/THEFT", "BURGLARY", "FRAUD",
]);

function mapToNibrs(type: string | undefined): CrimeCategory {
  const t = (type ?? "").toUpperCase().trim();
  if (PERSONS_TYPES.has(t)) return CrimeCategory.PERSONS;
  if (PROPERTY_TYPES.has(t)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "Honolulu Police Department Incidents (data.honolulu.gov, Socrata)",
  datasetUrl: "https://data.honolulu.gov/Public-Safety/Police-Incidents/vg88-5rn5",
  recency: "Refreshed daily by HPD",
  granularity: "neighborhood",
  disclaimer:
    "These are dispatched incident records published by the Honolulu " +
    "Police Department to the City and County of Honolulu's open-data " +
    "portal. HPD does not publish per-incident latitude/longitude or " +
    "neighborhood labels — only a redacted block-address string — so " +
    "CommunitySafe assigns each row to a named Honolulu neighborhood " +
    "via OpenStreetMap Nominatim reverse-geocoding (cached offline). " +
    "Addresses outside the cached map fall into a citywide bucket. " +
    "CommunitySafe does not request demographic columns.",
};

function safeIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime()) || d.getTime() <= 0) return null;
  return d.toISOString();
}

function buildIndexes(rows: Incident[]): Pick<Cache, "slugToLabel" | "labelToRows"> {
  const slugToLabel = new Map<string, string>();
  const labelToRows = new Map<string, Incident[]>();
  for (const r of rows) {
    const label = r.area;
    if (!label) continue;
    let bucket = labelToRows.get(label);
    if (!bucket) { bucket = []; labelToRows.set(label, bucket); }
    bucket.push(r);
    if (!slugToLabel.has(label)) {
      slugToLabel.set(slugify(label), label);
    }
  }
  return { slugToLabel, labelToRows };
}

async function fetchHonolulu(): Promise<Incident[]> {
  // v96 — migrated to fetchSocrata helper.
  const rows = await fetchSocrata<HnlRow>("Honolulu Socrata", {
    url: BASE,
    select: "objectid,incidentnum,blockaddress,date,type,status",
    where: "date IS NOT NULL",
    order: "date DESC",
    limit: ROW_LIMIT,
  });
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const occurredAt = safeIso(r.date);
    if (!occurredAt) continue;
    const resolved = resolveNeighborhood(r.blockaddress);
    out.push({
      id: `hnl-${r.objectid ?? r.incidentnum ?? i}`,
      area: resolved.label,
      occurredAt,
      nibrsCategory: mapToNibrs(r.type),
      ibrOffenseDescription: titleCaseOffense(r.type ?? "Unknown"),
      beat: null,
      blockLabel: r.blockaddress?.trim() || undefined,
      lat: resolved.lat,
      lng: resolved.lng,
    });
  }
  // v98 — canonicalize Hawaiian diacritic variants. The offline geocode
  // map (built from Nominatim) spells the same neighborhood inconsistently
  // — e.g. "Wahiawā"/"Wahiawa", "Nānākuli"/"Nanakuli", "‘Āhuimanu"/
  // "Ahuimanu". slugify() folds them to one slug, but the discovery
  // grouped by raw label, producing TWO areas with the SAME slug — a
  // duplicate that split the neighborhood's incidents and shadowed one in
  // the picker (caught by the full-fleet data audit). Collapse every label
  // to one canonical form per slug, preferring the spelling with the most
  // ʻokina/kahakō (the correct Hawaiian form) so the display stays proper.
  const nonAscii = (s: string) => [...s].filter((c) => (c.codePointAt(0) ?? 0) > 127).length;
  const canonBySlug = new Map<string, string>();
  for (const r of out) {
    if (!r.area) continue;
    const slug = slugify(r.area);
    const cur = canonBySlug.get(slug);
    if (cur === undefined || nonAscii(r.area) > nonAscii(cur)) canonBySlug.set(slug, r.area);
  }
  for (const r of out) {
    if (r.area) r.area = canonBySlug.get(slugify(r.area)) ?? r.area;
  }
  return out;
}

// In-flight Promise dedup (same pattern as detroit-arcgis.ts).
let inFlightHnlFetch: Promise<Incident[]> | null = null;

export async function getRowsHonolulu(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightHnlFetch) return inFlightHnlFetch;
  inFlightHnlFetch = (async () => {
    try {
      const rows = await fetchHonolulu();
      if (rows.length > 0) cache = { fetchedAt: now, rows, ...buildIndexes(rows) };
      return rows;
    } catch (err) {
      console.warn("[honolulu] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightHnlFetch = null;
    }
  })();
  return inFlightHnlFetch;
}

// discover() returns one KnownArea per unique Honolulu neighborhood
// observed in the row cache, plus a citywide "Honolulu" entry so
// pages that didn't drill into a specific neighborhood still resolve.
// Centroids come from the geocode JSON (computed as the mean of all
// geocoded lat/lngs in that neighborhood); falls back to the
// neighborhood-aggregate centroid when the JSON is empty (dev mode).
export async function getDiscoveredAreasHonolulu(): Promise<KnownArea[]> {
  await getRowsHonolulu();
  const labelToCentroid = new Map<string, { lat: number; lng: number }>();
  for (const n of GEOCODE_MAP.neighborhoods ?? []) {
    labelToCentroid.set(n.name, n.centroid);
  }
  const labels = new Set<string>();
  if (cache?.labelToRows) {
    for (const label of cache.labelToRows.keys()) labels.add(label);
  }
  // Always include the citywide bucket as a fallback.
  labels.add("Honolulu");
  const out: KnownArea[] = [];
  for (const label of labels) {
    const centroid = labelToCentroid.get(label) ?? HONOLULU_CENTROID;
    const slugBody = slugify(label);
    out.push({
      slug: label === "Honolulu" ? "honolulu" : `hnl-${slugBody}`,
      label,
      jurisdiction: "Honolulu",
      centroid,
    });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

function labelForHonoluluSlug(slug: string): string | null {
  if (!cache) return null;
  if (slug === "honolulu") return "Honolulu";
  const s = slug.toLowerCase();
  const want = s.startsWith("hnl-") ? s.slice(4) : s;
  return cache.slugToLabel.get(want) ?? null;
}

export const honoluluAdapter: CrimeDataAdapter = {
  name: "honolulu-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    await getRowsHonolulu();
    const label = labelForHonoluluSlug(area);
    if (!label) return null;
    const inArea = cache?.labelToRows.get(label) ?? [];
    if (inArea.length === 0) return null;
    // Self-calibrating quintile bands over this city's own per-area
    // distribution (the cached labelToRows map sizes, floored at 3 to
    // ignore stray geocodes); degrades to the prior hand-tuned thresholds.
    const dist = [...(cache?.labelToRows.values() ?? [])].map((g) => g.length).filter((n) => n >= 3);
    const riskLevel = bucketByBands(inArea.length, deriveBands(dist, [150, 400, 800, 1500]));
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    await getRowsHonolulu();
    const label = labelForHonoluluSlug(area);
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
