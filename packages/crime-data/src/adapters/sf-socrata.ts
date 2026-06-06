import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { fetchSocrata } from "../lib/http.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";

// City of San Francisco — Police Department Incident Reports 2018 to Present.
// Socrata dataset wg3w-h783 on data.sfgov.org. Documented + current.
// Doc: https://dev.socrata.com/foundry/data.sfgov.org/wg3w-h783

const BASE = "https://data.sfgov.org/resource/wg3w-h783.json";
// 5-minute cache: half the client's 10-minute refresh window so a 10-minute
// client refresh always lands on a fresh upstream pull (matched TTLs were
// causing repeated stale-looking responses).
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; }, "sfpd-socrata");

interface SodaRow {
  incident_id?: string;
  incident_datetime?: string;
  analysis_neighborhood?: string;
  police_district?: string;
  incident_category?: string;
  incident_subcategory?: string;
  incident_description?: string;
  latitude?: string;
  longitude?: string;
}

const PERSONS_CATS = new Set([
  // v99 — over-count fix. Removed "offences against the family and children"
  // (its members are restraining-order / stay-away-order violations and
  // DV/hate-crime SECONDARY codes — not UCR Part-1 persons crimes; ~2,300
  // rows/6mo were being counted as violent). Removed "sex offense" (SFPD's
  // non-rape bucket: indecent exposure, obscene calls — not Part-1) and ADDED
  // "rape" (SFPD files true forcible rape under its own category, which was
  // missing here, so genuine Part-1 rape had been UNDER-counted). "assault"
  // stays: the adapter prepends incident_subcategory so "Simple Assault — …"
  // is already dropped by isPart1Violent's /\bsimple\b/ while "Aggravated
  // Assault — …" is kept.
  "assault", "rape", "robbery", "homicide", "kidnapping",
  "human trafficking", "weapons offense",
]);
const PROPERTY_CATS = new Set([
  "larceny theft", "burglary", "motor vehicle theft", "arson",
  "vandalism", "stolen property", "embezzlement", "fraud",
  "forgery and counterfeiting", "recovered vehicle",
]);

function mapToNibrs(row: SodaRow): CrimeCategory {
  const cat = (row.incident_category ?? "").trim().toLowerCase();
  if (PERSONS_CATS.has(cat)) return CrimeCategory.PERSONS;
  if (PROPERTY_CATS.has(cat)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "SFPD Incident Reports (City of San Francisco Open Data)",
  datasetUrl: "https://data.sfgov.org/Public-Safety/Police-Department-Incident-Reports-2018-to-Present/wg3w-h783",
  recency: "Refreshed daily by SFPD",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the San Francisco Police Department and aggregated " +
    "to analysis neighborhood. Not live, not street-level. CommunitySafe does not " +
    "track individuals.",
};

async function fetchSF(): Promise<Incident[]> {
  // v96 — migrated to the shared fetchSocrata helper. Adapter now
  // only owns: the dataset URL, the field-mapping logic, and the
  // row → Incident transformation. HTTP status / JSON envelope /
  // 30 s default timeout / X-App-Token handling all live in
  // ../lib/http.ts.
  // v96p2 — 180-day recent window per the deployment-log scan.
  const rows = await fetchSocrata<SodaRow>("SFPD", {
    url: BASE,
    select: "incident_id,incident_datetime,analysis_neighborhood,police_district,incident_category,incident_subcategory,incident_description,latitude,longitude",
    windowDays: 180,
    dateField: "incident_datetime",
    order: "incident_datetime DESC",
    limit: 50000,
  });
  return rows.map((r, i) => {
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    return {
      id: `sf-${r.incident_id ?? i}`,
      area: r.analysis_neighborhood?.trim() || r.police_district?.trim() || "Unknown",
      // v96p2 — SFPD incident_datetime is wall-clock SF local time.
      occurredAt: cityLocalToUtcIso(r.incident_datetime, "America/Los_Angeles"),
      nibrsCategory: mapToNibrs(r),
      // v31 calibration: prepend the subcategory so the downstream
      // Part-1 filter sees "Simple Assault" vs "Aggravated Assault"
      // (SF splits 42k simple / 25k aggravated under one "Assault"
      // category; only aggravated is Part-1 violent). Without this
      // prefix the bare incident_description like "Battery" didn't
      // hit any /\bsimple\b/i or /\bother assault/i exclude, so
      // every Assault row inflated SF's violent rate to 3× FBI.
      ibrOffenseDescription: [r.incident_subcategory?.trim(), r.incident_description?.trim()]
        .filter(Boolean)
        .join(" — ") || r.incident_category?.trim() || "Unknown",
      beat: r.police_district ?? null,
      blockLabel: undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lon) && lon !== 0 ? lon : undefined,
    };
  });
}

// v107 — in-flight fetch dedup (the OOM-guard Detroit added in v94): the
// dispatcher fans a per-area Promise.all over every neighbourhood, so a cold
// cache previously fired N concurrent full fetches. Concurrent callers now
// await the same promise.
let inFlightSFFetch: Promise<Incident[]> | null = null;
export async function getRowsSF(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightSFFetch) return inFlightSFFetch;
  inFlightSFFetch = (async () => {
    try {
      const rows = await fetchSF();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[sf] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightSFFetch = null;
    }
  })();
  return inFlightSFFetch;
}

export async function getDiscoveredAreasSF(): Promise<KnownArea[]> {
  const rows = await getRowsSF();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    const name = r.area?.trim();
    if (!name || name === "Unknown") continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(name) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat; e.lngSum += r.lng; e.count += 1;
    agg.set(name, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 3)
    .map(([name, e]) => ({
      slug: `sf-${name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "San Francisco",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("sf-") ? s.slice(3) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return rows.find((r) => r.area.toLowerCase() === s)?.area ?? null;
}

export const sfAdapter: CrimeDataAdapter = {
  name: "sfpd-socrata",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsSF();
    const label = labelForSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area.toLowerCase() === label.toLowerCase());
    if (inArea.length === 0) return null;
    // Self-calibrating quintile bands over SF's own per-area
    // distribution (case-folded to match the case-insensitive area
    // lookup); degrades to the prior hand-tuned thresholds.
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [200, 600, 1200, 2000], (r) => r.area.toLowerCase());
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },
  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsSF();
    const label = labelForSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area.toLowerCase() === label.toLowerCase());
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area: string, opts?: { limit?: number }) {
    return this.getIncidents(area, { limit: opts?.limit ?? 20 });
  },
};
