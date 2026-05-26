import { CrimeCategory } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import type { KnownArea } from "../neighborhoods.js";
import { socrataHeaders } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";

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

// Load the address→neighborhood map shipped with the package. The
// build copies src/data/*.json to dist/data/, so resolve relative
// to this file's location and the JSON sits next to us regardless
// of whether we're running from src (dev/typecheck) or dist (prod).
function loadGeocodeMap(): GeocodeJson {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // adapters/ → data/honolulu-blockaddress-neighborhood.json (sibling dir)
    const filePath = path.resolve(here, "..", "data", "honolulu-blockaddress-neighborhood.json");
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as GeocodeJson;
  } catch {
    // File missing or unreadable — return empty map; adapter falls
    // back to citywide-only behavior. Useful during dev before the
    // one-time geocode batch has run.
    return { addresses: {}, neighborhoods: [] };
  }
}
const GEOCODE_MAP = loadGeocodeMap();

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
  "ASSAULT", "ROBBERY", "HOMICIDE", "SEX CRIMES", "WEAPONS",
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
  const select = "objectid,incidentnum,blockaddress,date,type,status";
  const u = `${BASE}?$limit=${ROW_LIMIT}&$select=${select}&$order=date%20DESC&$where=date%20IS%20NOT%20NULL`;
  const res = await fetch(u, {
    headers: socrataHeaders(u),
  });
  if (!res.ok) throw new Error(`Honolulu Socrata ${res.status}`);
  const rows = (await res.json()) as HnlRow[];
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
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 1500 ? 5 : inArea.length > 800 ? 4 : inArea.length > 400 ? 3 : inArea.length > 150 ? 2 : 1;
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
