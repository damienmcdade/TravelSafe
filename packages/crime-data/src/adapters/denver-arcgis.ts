import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";

// Denver — ODC_CRIME_OFFENSES_P on services1.arcgis.com.
// This is an ESRI Feature Server, not a Socrata SODA endpoint. Pagination is
// resultOffset / resultRecordCount, dates are epoch-ms ints, and responses
// wrap each row in { attributes, geometry } instead of returning bare rows.
//
// UPSTREAM OUTAGE (probed 2026-05-24): every public Denver crime endpoint
// now returns "Token Required" (HTTP 499) or 403 Forbidden:
//   - FeatureServer/324/query     → 499 GWM_0003 Token Required
//   - hub.arcgis.com data download → 403 Forbidden
//   - www.denvergov.org CSV path   → 301 redirect to the Hub (then 500)
// The dataset still exists (linked from
// https://opendata-geospatialdenver.hub.arcgis.com) but is no longer
// publicly readable. We try the request anyway and fall back to an
// empty list — the Coverage page surfaces this as "warming up". To
// restore Denver coverage, contact Denver Open Data for an API token
// and wire it into env DENVER_ARCGIS_TOKEN.
//
// Doc: https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_CRIME_OFFENSES_P/FeatureServer

const BASE = "https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_CRIME_OFFENSES_P/FeatureServer/324/query";
const PAGE_SIZE = 2000;
// v99 — was 5 (10,000 rows ≈ 7 weeks!). That tiny window (windowDays=63) plus
// recent reporting lag deflated the violent rate to 0.56× FBI. Denver publishes
// ~58k incidents/yr; 35 pages (70k ≈ 14 months) gives a representative window.
// Classification is correct (menacing-felony INCLUDE-override already added).
const PAGES = 35;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; });

interface DenverRow {
  OFFENSE_ID?: string;
  OFFENSE_CATEGORY_ID?: string;  // kebab-case: "public-disorder", "all-other-crimes"
  OFFENSE_TYPE_ID?: string;      // kebab-case: "criminal-mischief-other"
  FIRST_OCCURRENCE_DATE?: number; // epoch ms
  NEIGHBORHOOD_ID?: string;      // kebab-case: "five-points"
  DISTRICT_ID?: string;
  GEO_LAT?: number;
  GEO_LON?: number;
}

// Denver's `OFFENSE_CATEGORY_ID` is a clean controlled vocabulary. Mapping
// stays explicit instead of substring-based to avoid false positives.
const PERSONS_CATEGORIES = new Set([
  "aggravated-assault", "murder", "robbery", "sexual-assault",
  "other-crimes-against-persons",
]);
const PROPERTY_CATEGORIES = new Set([
  "burglary", "larceny", "auto-theft", "theft-from-motor-vehicle",
  "arson", "white-collar-crime",
]);
function mapToNibrs(row: DenverRow): CrimeCategory {
  const c = (row.OFFENSE_CATEGORY_ID ?? "").toLowerCase();
  if (PERSONS_CATEGORIES.has(c)) return CrimeCategory.PERSONS;
  if (PROPERTY_CATEGORIES.has(c)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "Denver Crime Offenses (Denver Open Data, ArcGIS Feature Server)",
  datasetUrl: "https://opendata-geospatialdenver.hub.arcgis.com/datasets/crime-and-incidents-of-disorder",
  recency: "Refreshed daily M-F by the Denver Police Department",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Denver Police Department and aggregated " +
    "to Denver's 78 statistical neighborhoods — not live, not street-level. " +
    "CommunitySafe does not track individuals.",
};

/// Turn "five-points" into "Five Points" for display. The polygon file uses
/// title-cased names so we normalize on intake.
function titleizeId(id: string): string {
  return id.split("-").map((w) => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}

async function fetchPage(offset: number): Promise<DenverRow[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "OFFENSE_ID,OFFENSE_CATEGORY_ID,OFFENSE_TYPE_ID,FIRST_OCCURRENCE_DATE,NEIGHBORHOOD_ID,GEO_LAT,GEO_LON");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "FIRST_OCCURRENCE_DATE DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true"); // v87 — Esri edge cache
  url.searchParams.set("f", "json");
  // Pass an ArcGIS token if one's configured. As of May 2026 Denver's
  // crime FeatureServer requires auth (returns 499 GWM_0003 without
  // a token); when DENVER_ARCGIS_TOKEN is unset every call 499s and
  // the adapter returns empty.
  if (process.env.DENVER_ARCGIS_TOKEN) {
    url.searchParams.set("token", process.env.DENVER_ARCGIS_TOKEN);
  }
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
  });
  if (!res.ok) throw new Error(`Denver ArcGIS ${res.status} offset=${offset}`);
  const body = await res.json() as { features?: Array<{ attributes: DenverRow }>; error?: { code?: number; message?: string } };
  if (body.error) {
    // ArcGIS returns HTTP 200 with an embedded error envelope for
    // 499 Token Required, so the !res.ok check above doesn't catch
    // it. Surface clearly so /coverage can show the auth state.
    throw new Error(`Denver ArcGIS embedded error ${body.error.code}: ${body.error.message}`);
  }
  return (body.features ?? []).map((f) => f.attributes);
}

async function fetchDenver(): Promise<Incident[]> {
  const pages = await Promise.all(
    Array.from({ length: PAGES }, (_, i) => fetchPage(i * PAGE_SIZE).catch(() => [] as DenverRow[])),
  );
  const rows = pages.flat();
  return rows.map((r, i) => {
    const lat = r.GEO_LAT;
    const lon = r.GEO_LON;
    const area = r.NEIGHBORHOOD_ID ? titleizeId(r.NEIGHBORHOOD_ID) : "Unknown";
    return {
      id: `den-${r.OFFENSE_ID ?? i}`,
      area,
      occurredAt: r.FIRST_OCCURRENCE_DATE ? new Date(r.FIRST_OCCURRENCE_DATE).toISOString() : new Date(0).toISOString(),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.OFFENSE_TYPE_ID ? titleizeId(r.OFFENSE_TYPE_ID) : (r.OFFENSE_CATEGORY_ID ?? "Unknown"),
      beat: null,
      blockLabel: undefined,
      lat: typeof lat === "number" && lat !== 0 ? lat : undefined,
      lng: typeof lon === "number" && lon !== 0 ? lon : undefined,
    };
  });
}

export async function getRowsDenver(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchDenver();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[denver] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasDenver(): Promise<KnownArea[]> {
  const rows = await getRowsDenver();
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
      slug: `den-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Denver",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForDenverSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("den-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const denverAdapter: CrimeDataAdapter = {
  name: "denver-arcgis",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsDenver();
    const label = labelForDenverSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [60, 200, 400, 800]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsDenver();
    const label = labelForDenverSlug(area, rows);
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
