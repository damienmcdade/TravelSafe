import "server-only";
import { CrimeCategory } from "@prisma/client";
import { env } from "../../../lib/env";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";

// City of Boston — Crime Incident Reports (BPD).
//
// data.boston.gov returns 0 records when called directly from Vercel's IP
// range for any non-trivial response (the block is at Boston's CDN edge —
// proven by limit=2 working everywhere, limit≥500 failing only from Vercel).
// To bypass it we deploy a tiny Cloudflare Worker (see /workers/boston-proxy)
// that forwards the same CKAN query from Cloudflare's edge. When
// BOSTON_PROXY_URL is set we route through it; otherwise fall back to direct
// (which works for any non-Vercel runtime).
//
// CKAN doc: https://data.boston.gov/dataset/crime-incident-reports-august-2015-to-date-source-new-system

const RESOURCE_ID = "b973d8cb-eeb2-4e7e-99da-c92938efc9c0";
// datastore_search (NOT datastore_search_sql) — the SQL endpoint times out
// from Vercel's runtime against this dataset for any LIMIT above a few
// thousand. The simple search endpoint returns the same shape but supports
// limit/offset URL params with much better tail latency, and supports sort
// directly via &sort= so we still get the freshest rows first.
const SEARCH_BASE = "https://data.boston.gov/api/3/action/datastore_search";
// Boston's CKAN endpoint returns 0 records from Vercel's serverless
// runtime for any limit at 500 or above, but the limit=2 sanity probe
// returns 200 OK consistently. Strategy: pull in 10 paginated pages of
// 100 rows each = 1,000 fresh rows. If even small responses fail from
// Vercel, the failure is network-level (ASN block) and Boston should
// stay coming-soon.
const PAGE_SIZE = 100;
const PAGES = 10;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface BostonRow {
  INCIDENT_NUMBER?: string;
  OFFENSE_DESCRIPTION?: string;
  OFFENSE_CODE_GROUP?: string | null;
  DISTRICT?: string;
  OCCURRED_ON_DATE?: string;
  Lat?: string | null;
  Long?: string | null;
  SHOOTING?: string;
}

// BPD's offense descriptions are free-text and noisy. Substring match captures
// the bulk of cases without trying to encode every variant.
const PERSONS_KEYWORDS = [
  "ASSAULT", "ROBBERY", "MURDER", "HOMICIDE", "RAPE", "SEX",
  "HARASSMENT", "KIDNAP", "STALKING", "STRANGULATION",
];
const PROPERTY_KEYWORDS = [
  "THEFT", "LARCENY", "BURGLARY", "STOLEN", "ARSON",
  "VANDALISM", "PROPERTY DAMAGE", "MOTOR VEHICLE", "AUTO THEFT",
  "FORGERY", "FRAUD", "TRESPASS",
];
function mapToNibrs(row: BostonRow): CrimeCategory {
  const d = (row.OFFENSE_DESCRIPTION ?? "").toUpperCase();
  if (PERSONS_KEYWORDS.some((k) => d.includes(k))) return CrimeCategory.PERSONS;
  if (PROPERTY_KEYWORDS.some((k) => d.includes(k))) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// BPD's 12 districts, each with a memorable neighborhood description so users
// see "A1: Downtown / North End / Beacon Hill" rather than just "A1".
const DISTRICT_NEIGHBORHOODS: Record<string, string> = {
  "A1":  "Downtown, North End, Beacon Hill, Chinatown",
  "A7":  "East Boston",
  "A15": "Charlestown",
  "B2":  "Roxbury",
  "B3":  "Mattapan",
  "C6":  "South Boston",
  "C11": "Dorchester",
  "D4":  "South End, Back Bay, Fenway",
  "D14": "Brighton, Allston",
  "E5":  "West Roxbury, Roslindale",
  "E13": "Jamaica Plain, Mission Hill",
  "E18": "Hyde Park",
};

function enrich(district: string | undefined): string {
  if (!district) return "Unknown";
  const d = district.trim().toUpperCase();
  const nbh = DISTRICT_NEIGHBORHOODS[d];
  return nbh ? `${d}: ${nbh}` : d;
}

const PROVENANCE: DataProvenance = {
  source: "Boston Police Department Crime Incident Reports (City of Boston Open Data, CKAN)",
  datasetUrl: "https://data.boston.gov/dataset/crime-incident-reports-august-2015-to-date-source-new-system",
  recency: "Refreshed by BPD (~1-month publication lag)",
  granularity: "beat",
  disclaimer:
    "Incidents are reported by the Boston Police Department and aggregated to " +
    "BPD's 12 districts — not live, not street-level. TravelSafe does not track individuals.",
};

function endpointBase(): string {
  // Route through the Cloudflare Worker proxy if configured. The Worker's
  // /datastore_search endpoint accepts the same CKAN query params we'd send
  // to data.boston.gov, so the only difference here is the URL host.
  const proxy = env.BOSTON_PROXY_URL;
  if (proxy) {
    const trimmed = proxy.replace(/\/+$/, "");
    return `${trimmed}/datastore_search`;
  }
  return SEARCH_BASE;
}

async function fetchPage(offset: number): Promise<BostonRow[]> {
  const sort = encodeURIComponent("OCCURRED_ON_DATE desc");
  const u = `${endpointBase()}?resource_id=${RESOURCE_ID}&limit=${PAGE_SIZE}&offset=${offset}&sort=${sort}`;
  const res = await fetch(u, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 TravelSafe/0.1 (https://github.com/damienmcdade/TravelSafe)",
    },
  });
  if (!res.ok) throw new Error(`Boston CKAN ${res.status} offset=${offset}`);
  const body = await res.json() as { success?: boolean; error?: unknown; result?: { records?: BostonRow[] } };
  if (body.success === false) throw new Error(`Boston CKAN error: ${JSON.stringify(body.error)}`);
  return body.result?.records ?? [];
}

async function fetchBoston(): Promise<Incident[]> {
  // Paginate in 100-row chunks. Large single-shot responses (≥500 rows) get
  // dropped on the Vercel→data.boston.gov hop for reasons we couldn't pin
  // down — small responses go through cleanly.
  const pages = await Promise.all(
    Array.from({ length: PAGES }, (_, i) => fetchPage(i * PAGE_SIZE).catch(() => [] as BostonRow[])),
  );
  const rows = pages.flat();
  return rows.map((r, i) => {
    const lat = Number(r.Lat);
    const lon = Number(r.Long);
    return {
      id: `bos-${r.INCIDENT_NUMBER ?? i}`,
      area: enrich(r.DISTRICT),
      occurredAt: r.OCCURRED_ON_DATE ? new Date(r.OCCURRED_ON_DATE.replace(" ", "T")).toISOString() : new Date(0).toISOString(),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.OFFENSE_DESCRIPTION?.trim() || "Unknown",
      beat: r.DISTRICT ?? null,
      blockLabel: undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lon) && lon !== 0 ? lon : undefined,
    };
  });
}

export async function getRowsBoston(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchBoston();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[boston] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasBoston(): Promise<KnownArea[]> {
  const rows = await getRowsBoston();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown" || r.area === "External") continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat; e.lngSum += r.lng; e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 3)
    .map(([name, e]) => {
      const districtTag = name.split(":")[0].trim().toLowerCase();
      return {
        slug: `bos-${districtTag}`,
        label: name,
        jurisdiction: "Boston",
        centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForBostonSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("bos-") ? s.slice(4).toUpperCase() : s.toUpperCase();
  for (const r of rows) {
    const head = r.area.split(":")[0].trim().toUpperCase();
    if (head === want) return r.area;
  }
  return null;
}

export const bostonAdapter: CrimeDataAdapter = {
  name: "boston-ckan",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsBoston();
    const label = labelForBostonSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 1200 ? 5 : inArea.length > 700 ? 4 : inArea.length > 350 ? 3 : inArea.length > 120 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsBoston();
    const label = labelForBostonSlug(area, rows);
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
