import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import type { KnownArea } from "../neighborhoods.js";
import { fetchSocrata } from "../lib/http.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";

// City of Los Angeles — LAPD NIBRS Offenses Dataset 2024 to 2025.
// Socrata dataset y8y3-fqfu on data.lacity.org.
//
// The legacy "Crime Data from 2020 to Present" dataset (2nrs-mtv8)
// stopped accepting new rows at the end of 2024 — by the time of
// this adapter rewrite the newest date_occ on the legacy feed was
// 2024-12-30, which fell outside the safety-score 365d wall-clock
// window and broke every LA score in production. The new dataset
// is in proper NIBRS format with a direct `crime_against` column
// (Person/Property/Society) so we no longer need the legacy
// Part I/II heuristic — accuracy improves as a side effect.
//
// IMPORTANT: The dataset publishes incident metadata only.
// TravelSafe's spec forbids displaying or storing victim/suspect
// demographic data; we just don't request those columns.

// v70 — switched primary to the "2026-to-Present" dataset (k7nn-b2ep)
// which LAPD publishes bi-weekly (last update May 12 2026, 13 days
// fresh) vs the 2024-2025 dataset (y8y3-fqfu) that was ~4 months
// behind. Same column schema. We still pull the 2024-2025 dataset
// for historical depth as a SECONDARY merge — gives both recent
// freshness and the multi-year safety-score window cap of 365 days.
const BASE = "https://data.lacity.org/resource/k7nn-b2ep.json";
const HISTORICAL_BASE = "https://data.lacity.org/resource/y8y3-fqfu.json";
// 5-minute cache: half the client's 10-minute refresh window. With matched
// 10/10 minute TTLs the client could land on a stale cache right before it
// expired and see the same data twice in a row, which read as "the app isn't
// updating". A 5-minute server TTL guarantees a fresh upstream pull every
// 10-minute client refresh.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface SodaRow {
  caseno?: string;
  uniquenibrno?: string;
  date_occ?: string;
  area_name?: string;
  nibr_code?: string;
  nibr_description?: string;
  /// "Person" | "Property" | "Society" — direct NIBRS classification
  /// published by LAPD. Maps cleanly to our CrimeCategory enum.
  crime_against?: string;
  rpt_dist_no?: string;
  // The NIBRS dataset doesn't publish per-row lat/lng. Discovery
  // falls back to a sensible LAPD-division centroid instead — see
  // AREA_CENTROIDS below.
}

function mapToNibrs(row: SodaRow): CrimeCategory {
  const v = (row.crime_against ?? "").trim().toLowerCase();
  // LAPD's NIBRS feed emits a multi-category string when a single
  // incident spans groups ("Person, Property, Society", 8k+ rows).
  // The prior exact-match dropped those to SOCIETY; treat any string
  // that mentions "person" as PERSONS first (most severe), then
  // "property", so the multi-row's violent component is preserved.
  if (v.includes("person")) return CrimeCategory.PERSONS;
  if (v.includes("property")) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// Approximate centroids for the 21 LAPD patrol divisions. The NIBRS
// dataset doesn't publish per-row coordinates, so for the Crime Map
// and the neighborhood-discovery code we anchor each division to a
// representative point. Values are eyeball-checked against the
// LAPD's published division-boundary map.
const AREA_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  "central":       { lat: 34.0463, lng: -118.2476 },
  "rampart":       { lat: 34.0744, lng: -118.2769 },
  "southwest":     { lat: 34.0173, lng: -118.3047 },
  "hollenbeck":    { lat: 34.0444, lng: -118.2090 },
  "harbor":        { lat: 33.7793, lng: -118.2655 },
  "hollywood":     { lat: 34.0980, lng: -118.3268 },
  "wilshire":      { lat: 34.0617, lng: -118.3441 },
  "west la":       { lat: 34.0464, lng: -118.4438 },
  "van nuys":      { lat: 34.1855, lng: -118.4493 },
  "west valley":   { lat: 34.1948, lng: -118.5436 },
  "northeast":     { lat: 34.1031, lng: -118.2079 },
  "77th street":   { lat: 33.9706, lng: -118.2880 },
  "newton":        { lat: 34.0149, lng: -118.2548 },
  "pacific":       { lat: 33.9888, lng: -118.4439 },
  "n hollywood":   { lat: 34.1697, lng: -118.3851 },
  "foothill":      { lat: 34.2625, lng: -118.4192 },
  "devonshire":    { lat: 34.2569, lng: -118.5392 },
  "southeast":     { lat: 33.9396, lng: -118.2473 },
  "mission":       { lat: 34.2719, lng: -118.4587 },
  "olympic":       { lat: 34.0578, lng: -118.3122 },
  "topanga":       { lat: 34.2113, lng: -118.5824 },
};
function centroidFor(name: string): { lat: number; lng: number } | null {
  return AREA_CENTROIDS[name.toLowerCase().trim()] ?? null;
}

// LAPD publishes division names in a mix of full and abbreviated
// forms ("Central", "N Hollywood", "West LA", "77th Street"). The
// abbreviated ones look slapdash next to the full names. This map
// expands the abbreviations to friendly display labels — centroid
// lookup still works because that runs on the lowercased raw name.
const DIVISION_DISPLAY: Record<string, string> = {
  "n hollywood": "North Hollywood",
  "west la":     "West Los Angeles",
  "77th street": "77th Street",
  "central":     "Central LA",
};
function displayLabelLA(raw: string): string {
  return DIVISION_DISPLAY[raw.toLowerCase().trim()] ?? raw;
}

const PROVENANCE: DataProvenance = {
  source: "LAPD NIBRS Offenses 2026-to-Present + 2024–2025 (City of Los Angeles Open Data)",
  datasetUrl: "https://data.lacity.org/Public-Safety/LAPD-NIBRS-Offenses-Dataset-2026-to-Present/k7nn-b2ep",
  recency: "Refreshed bi-weekly by LAPD",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Los Angeles Police Department and aggregated to " +
    "LAPD patrol division — not live, not street-level. TravelSafe does not track " +
    "individuals and intentionally ignores victim/suspect-demographic columns " +
    "published by LAPD.",
};

async function fetchOne(baseUrl: string): Promise<SodaRow[]> {
  // v96 — migrated to fetchSocrata helper.
  return fetchSocrata<SodaRow>("LAPD SODA", {
    url: baseUrl,
    select: "caseno,uniquenibrno,date_occ,area_name,nibr_code,nibr_description,crime_against,rpt_dist_no",
    order: "date_occ DESC",
    limit: 50000,
  });
}

async function fetchLapd(): Promise<Incident[]> {
  // v70 — pull primary (2026-to-present) + historical (2024-2025) in
  // parallel. Each dataset caps at 50k Socrata rows. Dedupe by
  // uniquenibrno so an incident reported under both datasets only
  // counts once. The fresh primary dataset drives recent grades;
  // the historical adds depth for the 365-day window.
  const [primary, historical] = await Promise.all([
    fetchOne(BASE).catch((e) => { console.warn("[lapd] primary fetch failed:", (e as Error).message); return [] as SodaRow[]; }),
    fetchOne(HISTORICAL_BASE).catch((e) => { console.warn("[lapd] historical fetch failed:", (e as Error).message); return [] as SodaRow[]; }),
  ]);
  const seen = new Set<string>();
  const merged: SodaRow[] = [];
  for (const r of [...primary, ...historical]) {
    const key = r.uniquenibrno ?? r.caseno ?? "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }
  return merged.map((r, i) => {
    const rawArea = r.area_name?.trim() || "Unknown";
    const area = displayLabelLA(rawArea);
    const cen = centroidFor(rawArea);
    return {
      id: `la-${r.uniquenibrno ?? r.caseno ?? i}`,
      area,
      // v96p2 — Socrata's date_occ is wall-clock LA local time
      // ("2026-05-16T22:40:49.000") with no TZ marker. Previously
      // shipped as-is so the frontend's `relativeTime` interpreted
      // it as local-of-browser and showed wrong "h ago" deltas.
      occurredAt: cityLocalToUtcIso(r.date_occ, "America/Los_Angeles"),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.nibr_description?.trim() || r.nibr_code?.trim() || "Unknown",
      beat: r.rpt_dist_no ?? null,
      blockLabel: undefined,
      lat: cen?.lat,
      lng: cen?.lng,
    };
  });
}

export async function getRowsLA(): Promise<Incident[]> {
  const now = Date.now();
  // Only honor cache if it actually has data — caching an empty failed fetch
  // for 6 hours would silently break discovery + UI.
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchLapd();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[lapd] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasLA(): Promise<KnownArea[]> {
  const rows = await getRowsLA();
  // Per-row lat/lng isn't published by the NIBRS feed; we count
  // incidents per area name and look the centroid up in
  // AREA_CENTROIDS instead. Skip areas with no centroid mapping
  // (would render as a tiny dot at 0,0 on the Crime Map).
  const counts = new Map<string, number>();
  for (const r of rows) {
    const name = r.area?.trim();
    if (!name || name === "Unknown") continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, n]) => n >= 3)
    .map(([name]) => {
      const cen = centroidFor(name);
      return cen ? {
        slug: `la-${name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
        label: name,
        jurisdiction: "Los Angeles",
        centroid: cen,
      } : null;
    })
    .filter((a): a is KnownArea => a !== null)
    .sort((a, b) => a.label.localeCompare(b.label));
}

export const lapdAdapter: CrimeDataAdapter = {
  name: "lapd-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsLA();
    const label = labelForLaSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area.toLowerCase() === label.toLowerCase());
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 2000 ? 5 : inArea.length > 1200 ? 4 : inArea.length > 600 ? 3 : inArea.length > 200 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsLA();
    const label = labelForLaSlug(area, rows);
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

function labelForLaSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  // Strip "la-" prefix if present
  const want = s.startsWith("la-") ? s.slice(3) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  // direct label match
  for (const r of rows) {
    if (r.area.toLowerCase() === s) return r.area;
  }
  return null;
}
