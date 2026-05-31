import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { fetchSocrata } from "../lib/http.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";

// Baton Rouge — Baton Rouge Police Crime Incidents.
// Socrata dataset pbin-pcm7 on data.brla.gov. Updated daily.
//
// Standout feature for an adapter: BRPD already publishes the NIBRS
// classification on every row via `crime_against` (PERSONS / PROPERTY /
// SOCIETY) so we don't have to infer it from offense names.

const BASE = "https://data.brla.gov/resource/pbin-pcm7.json";
const ROW_LIMIT = 5_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; });

interface BrRow {
  incident_number?: string;
  charge_id?: string;
  charge_date?: string;
  report_date?: string;
  offense_description?: string;
  statute_category?: string;
  crime_against?: string;      // "PERSONS" | "PROPERTY" | "SOCIETY"
  nibrs_code?: string;
  neighborhood?: string;
  district?: string;
  zone?: string;
  latitude?: string;
  longitude?: string;
}

function mapToNibrs(row: BrRow): CrimeCategory {
  // BRPD stamps the NIBRS group directly — read it off the row.
  const c = (row.crime_against ?? "").trim().toUpperCase();
  if (c === "PERSONS" || c === "PERSON") return CrimeCategory.PERSONS;
  if (c === "PROPERTY") return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

function titleCase(s: string): string {
  return s.toLowerCase().split(/\s+/).map((w) => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}

const PROVENANCE: DataProvenance = {
  source: "Baton Rouge Police Crime Incidents (City of Baton Rouge Open Data)",
  datasetUrl: "https://data.brla.gov/Public-Safety/Baton-Rouge-Police-Crime-Incidents/pbin-pcm7",
  recency: "Refreshed daily by BRPD; per-charge rows (one incident may produce multiple rows)",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Baton Rouge Police Department, with neighborhood " +
    "and NIBRS classification published per-row by BRPD. CommunitySafe does not request " +
    "or display the suspect / victim demographic columns that other LA datasets sometimes carry.",
};

// v99 — route the naive-local upstream timestamp through
// cityLocalToUtcIso so the hour-of-day histogram buckets by the
// city's real local clock instead of the UTC runtime (was shifting
// every incident by the source-city offset). See lib/city-time.ts.
function safeIso(raw: string | null | undefined): string {
  return cityLocalToUtcIso(raw, "America/Chicago");
}

async function fetchBr(): Promise<Incident[]> {
  // v96 — migrated to fetchSocrata helper.
  // Explicit $select — never request demographic columns even though BRPD
  // doesn't publish them on this dataset.
  // v96p2 — defensive 180-day recent window matching the rest of
  // the Socrata adapters; BR hasn't failed in production but the
  // pattern is uniform.
  const rows = await fetchSocrata<BrRow>("BR Socrata", {
    url: BASE,
    select: "incident_number,charge_id,report_date,offense_description,statute_category,crime_against,neighborhood,district,zone,latitude,longitude",
    where: "neighborhood IS NOT NULL",
    windowDays: 180,
    dateField: "report_date",
    order: "report_date DESC",
    limit: ROW_LIMIT,
  });
  return rows.map((r, i) => {
    const lat = Number(r.latitude);
    const lng = Number(r.longitude);
    return {
      id: `br-${r.charge_id ?? r.incident_number ?? i}`,
      area: r.neighborhood ? titleCase(r.neighborhood.trim()) : "Unknown",
      occurredAt: safeIso(r.report_date),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.offense_description?.trim() || r.statute_category?.trim() || "Unknown",
      beat: r.zone ?? null,
      blockLabel: undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lng) && lng !== 0 ? lng : undefined,
    };
  });
}

export async function getRowsBatonRouge(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchBr();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[br] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasBatonRouge(): Promise<KnownArea[]> {
  const rows = await getRowsBatonRouge();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat; e.lngSum += r.lng; e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 1)  // v89 — was 3; BR has ~80 official neighborhoods
    .map(([name, e]) => ({
      slug: `br-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Baton Rouge",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForBatonRougeSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("br-") ? s.slice(3) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const batonRougeAdapter: CrimeDataAdapter = {
  name: "baton-rouge-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsBatonRouge();
    const label = labelForBatonRougeSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [30, 80, 160, 300]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsBatonRouge();
    const label = labelForBatonRougeSlug(area, rows);
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
