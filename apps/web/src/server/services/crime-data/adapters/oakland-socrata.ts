import "server-only";
import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";

// City of Oakland — OPD Crime Reports.
// Socrata dataset ppgh-7dqv on data.oaklandca.gov.
// NOTE: Oakland's public crime data appears to only have older records on
// this dataset (pre-2014). It is included for architectural completeness;
// real-time Oakland crime data would need OPD's newer feed (TBD).

const BASE = "https://data.oaklandca.gov/resource/ppgh-7dqv.json";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface SodaRow {
  crimetype?: string;
  datetime?: string;
  casenumber?: string;
  description?: string;
  policebeat?: string;
  address?: string;
  city?: string;
  state?: string;
}

const VIOLENT = new Set(["assault", "robbery", "homicide", "kidnap", "sexual", "rape", "battery"]);
const PROPERTY = new Set(["burglary", "larceny", "theft", "auto theft", "vehicle theft", "arson", "vandalism", "fraud", "forgery", "embezzlement"]);

function mapToNibrs(row: SodaRow): CrimeCategory {
  const t = (row.crimetype ?? row.description ?? "").toLowerCase();
  if (Array.from(VIOLENT).some((w) => t.includes(w))) return CrimeCategory.PERSONS;
  if (Array.from(PROPERTY).some((w) => t.includes(w))) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "OPD Crime Reports (City of Oakland Open Data)",
  datasetUrl: "https://data.oaklandca.gov/dataset/Crime-Reports/ppgh-7dqv",
  recency: "Dataset published historically — Oakland does not currently publish a live crime feed on this resource. Coverage may be older than other cities.",
  granularity: "beat",
  disclaimer:
    "Oakland's public dataset is older than SF's and LA's. Numbers shown are historic, " +
    "not current week. TravelSafe does not track individuals.",
};

async function fetchOakland(): Promise<Incident[]> {
  const url = new URL(BASE);
  url.searchParams.set("$select", "crimetype,datetime,casenumber,description,policebeat,address,city,state");
  url.searchParams.set("$order", "datetime DESC");
  url.searchParams.set("$limit", "3000");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "TravelSafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
  });
  if (!res.ok) throw new Error(`OPD ${res.status}`);
  const rows = (await res.json()) as SodaRow[];
  return rows.map((r, i) => ({
    id: `oak-${r.casenumber ?? i}`,
    area: r.policebeat?.trim() || "Unknown",
    occurredAt: r.datetime ?? new Date(0).toISOString(),
    nibrsCategory: mapToNibrs(r),
    ibrOffenseDescription: r.description?.trim() || r.crimetype?.trim() || "Unknown",
    beat: r.policebeat ?? null,
    blockLabel: r.address ?? undefined,
    lat: undefined,
    lng: undefined,
  }));
}

export async function getRowsOakland(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchOakland();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[oakland] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasOakland(): Promise<KnownArea[]> {
  // The OPD dataset has no lat/lng — fall back to a small static list of
  // common Oakland police beats centered roughly. This is intentional: until
  // OPD publishes a current geocoded feed, the city is "available but stub".
  const rows = await getRowsOakland();
  if (rows.length === 0) return [];
  // Use unique beat values as "areas", centered at the city center.
  const beats = Array.from(new Set(rows.map((r) => r.area))).filter((b) => b && b !== "Unknown");
  const center = { lat: 37.804, lng: -122.271 };
  return beats.slice(0, 12).map((b) => ({
    slug: `oak-${b.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    label: `Oakland Beat ${b}`,
    jurisdiction: "Oakland",
    centroid: center,
  }));
}

function labelForSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("oak-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const oaklandAdapter: CrimeDataAdapter = {
  name: "opd-socrata",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsOakland();
    const label = labelForSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 500 ? 5 : inArea.length > 200 ? 4 : inArea.length > 80 ? 3 : inArea.length > 30 ? 2 : 1;
    return { area: `Oakland Beat ${label}`, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },
  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsOakland();
    const label = labelForSlug(area, rows);
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
