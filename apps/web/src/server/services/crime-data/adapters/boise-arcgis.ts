import "server-only";
import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";

// Boise — Boise Police Department Calls for Service.
// ArcGIS FeatureServer on services1.arcgis.com (owner: Boise_GIS).
//
// BPD tags every CFS row with `IncidentCategory` — Violent Crimes,
// Property Crimes, Society Crimes, Traffic, Community Assistance,
// Mental Health, Crash, Other. We filter at ingest to keep ONLY the
// three crime categories so per-neighborhood counts stay comparable
// to other cities' NIBRS feeds.
//
// `NeighborhoodAssociation` is the official Boise neighborhood-
// association name (35 distinct values like "Downtown Boise",
// "North End", "East End", "Hillcrest"). No demographic columns are
// published on this layer. Geometry is NOT on the feature service
// itself, so we record the area name directly and skip per-incident
// dots.

const BASE = "https://services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/BPD_CallsForService/FeatureServer/0/query";
const PAGE_SIZE = 2000;
// v26 bump 5 → 15. Boise CFS volume is much lower than Detroit's
// so 10k rows actually spans many months — but the deeper cache
// keeps the cfsScale calibration (0.30 in safety-score.ts) anchored
// to a more representative window.
const PAGES = 15;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface BoiseRow {
  CADIncidentNumber?: string;
  ResponseDateTimeUTC?: number;
  Agency?: string;
  CallSource?: string;
  CallType?: string;
  IncidentCategory?: string;
  CensusTract?: string;
  NeighborhoodAssociation?: string;
}

function mapToNibrs(category: string | undefined): CrimeCategory | null {
  const c = (category ?? "").toUpperCase().trim();
  if (c === "VIOLENT CRIMES")  return CrimeCategory.PERSONS;
  if (c === "PROPERTY CRIMES") return CrimeCategory.PROPERTY;
  if (c === "SOCIETY CRIMES")  return CrimeCategory.SOCIETY;
  // Traffic, Community Assistance, Mental Health, Crash, Other are
  // intentionally dropped — they are not reportable crimes.
  return null;
}

const PROVENANCE: DataProvenance = {
  source: "Boise Police Department Calls for Service (City of Boise Open Data, ArcGIS Feature Server)",
  datasetUrl: "https://opendata.cityofboise.org/datasets/bpd-calls-for-service",
  recency: "Refreshed near-daily by BPD; calls reach the public view within ~24h",
  granularity: "neighborhood",
  disclaimer:
    "These are BPD dispatched calls for service rather than closed NIBRS reports. " +
    "CommunitySafe keeps only rows BPD has already labeled as Violent / Property / " +
    "Society crimes — administrative categories (traffic, mental-health, " +
    "community-assistance) are filtered out at ingest. Some incidents may later " +
    "be reclassified or unfounded by BPD investigators.",
};

async function fetchPage(offset: number): Promise<BoiseRow[]> {
  const url = new URL(BASE);
  // Pull only the rows we'll keep. The Vegas/Cleveland adapters do this
  // filter client-side after fetch; here we can let the server prune.
  url.searchParams.set("where", "IncidentCategory IN ('Violent Crimes','Property Crimes','Society Crimes') AND NeighborhoodAssociation IS NOT NULL");
  url.searchParams.set("outFields", "CADIncidentNumber,ResponseDateTimeUTC,Agency,CallSource,CallType,IncidentCategory,CensusTract,NeighborhoodAssociation");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "ResponseDateTimeUTC DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("f", "json");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/CommunitySafe)" },
  });
  if (!res.ok) throw new Error(`Boise ArcGIS ${res.status} offset=${offset}`);
  const body = await res.json() as { features?: Array<{ attributes: BoiseRow }> };
  return (body.features ?? []).map((f) => f.attributes);
}

async function fetchBoise(): Promise<Incident[]> {
  const pages = await Promise.all(
    Array.from({ length: PAGES }, (_, i) => fetchPage(i * PAGE_SIZE).catch(() => [] as BoiseRow[])),
  );
  const rows = pages.flat();
  const out: Incident[] = [];
  for (const r of rows) {
    const cat = mapToNibrs(r.IncidentCategory);
    if (cat == null) continue;
    const area = r.NeighborhoodAssociation?.trim() || "Unknown";
    if (area === "Unknown") continue;
    out.push({
      id: `bzi-${r.CADIncidentNumber ?? out.length}`,
      area,
      occurredAt: r.ResponseDateTimeUTC ? new Date(r.ResponseDateTimeUTC).toISOString() : new Date(0).toISOString(),
      nibrsCategory: cat,
      ibrOffenseDescription: r.IncidentCategory ?? "Unknown",
      beat: r.CensusTract ? `Tract ${r.CensusTract}` : null,
      blockLabel: undefined,
      // No per-row lat/lng on this feed — area-level only.
      lat: undefined,
      lng: undefined,
    });
  }
  return out;
}

export async function getRowsBoise(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchBoise();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[bzi] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasBoise(): Promise<KnownArea[]> {
  // No per-row lat/lng on this feed — use the polygon centroid we already
  // ship for each area instead of synthesizing from incidents. For the
  // citywide endpoint, centroids only matter for "nearest area" geocoding,
  // and Boise is small enough that the polygon-name match path is enough.
  const rows = await getRowsBoise();
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    counts.set(r.area, (counts.get(r.area) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, c]) => c >= 3)
    .map(([name]) => ({
      slug: `bzi-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Boise",
      centroid: { lat: 43.62, lng: -116.21 }, // city centroid placeholder
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForBoiseSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("bzi-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const boiseAdapter: CrimeDataAdapter = {
  name: "boise-arcgis",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsBoise();
    const label = labelForBoiseSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 300 ? 5 : inArea.length > 150 ? 4 : inArea.length > 70 ? 3 : inArea.length > 20 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsBoise();
    const label = labelForBoiseSlug(area, rows);
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
