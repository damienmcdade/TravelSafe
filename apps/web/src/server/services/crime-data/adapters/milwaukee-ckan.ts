import "server-only";
import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";

// Milwaukee WI — Milwaukee Police Department WIBR (Wisconsin Incident-
// Based Reporting) crime data on data.milwaukee.gov.
//
// CKAN datastore (resource 87843297-a6fa-46d4-ba5d-cb342fb2d3bb) holds
// ~9.4k incidents with per-incident boolean offense flags. We pull the
// full dataset in one request (small enough to fit comfortably in
// memory), group by ZIP for area discovery, and map the boolean flags
// to NIBRS three-way buckets.

const MILWAUKEE_RESOURCE_ID = "87843297-a6fa-46d4-ba5d-cb342fb2d3bb";
const DATASTORE_API = "https://data.milwaukee.gov/api/3/action/datastore_search";
const PAGE_SIZE = 10_000; // dataset total is ~9.4k; one page covers it
const CACHE_TTL_MS = 10 * 60 * 1000;

interface RawRow {
  IncidentNum?: string;
  ReportedDateTime?: string;
  Location?: string;
  ZIP?: string;
  // Boolean-ish counts: 0/1 per offense category. Multiple can be set per
  // incident (e.g. burglary + criminal damage); we pick the highest-
  // precedence offense to drive the row's nibrsCategory + description.
  Arson?: string;
  AssaultOffense?: string;
  Burglary?: string;
  CriminalDamage?: string;
  Homicide?: string;
  LockedVehicle?: string;
  Robbery?: string;
  SexOffense?: string;
  Theft?: string;
  VehicleTheft?: string;
}

// Milwaukee ZIPs → neighborhood / area name. Public knowledge from
// Milwaukee's planning documents and community area profiles. Unknown
// ZIPs render as "Milwaukee 53xxx" via the fallback path.
const ZIP_NEIGHBORHOOD: Record<string, string> = {
  "53202": "East Town",
  "53203": "Downtown",
  "53204": "Walker's Point",
  "53205": "Concordia",
  "53206": "Sherman Park North",
  "53207": "Bay View",
  "53208": "Washington Park",
  "53209": "Granville",
  "53210": "West Park",
  "53211": "UWM",
  "53212": "Riverwest",
  "53213": "Tosa East",
  "53214": "West Side",
  "53215": "Lincoln Village",
  "53216": "Sherman Park West",
  "53217": "Fox Point",
  "53218": "Capitol Heights",
  "53219": "Jackson Park",
  "53220": "Greenfield Adjacent",
  "53221": "Tippecanoe",
  "53222": "Capitol Drive Area",
  "53223": "Brown Deer Adjacent",
  "53224": "Carleton Heights",
  "53225": "Northridge",
  "53226": "Wauwatosa Mayfair",
  "53227": "West Allis North",
  "53228": "Greenfield",
  "53233": "Marquette",
};

const PROVENANCE: DataProvenance = {
  source: "Milwaukee Police WIBR Crime Data · data.milwaukee.gov",
  datasetUrl: "https://data.milwaukee.gov/dataset/wibr",
  recency: "Daily refresh; ZIP-level aggregation",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Milwaukee Police Department under WIBR, aggregated to " +
    "ZIP-level neighborhood groupings. Not live, not street-level. CommunitySafe does not track individuals.",
};

// Each row may have multiple offense flags set. Pick the highest-
// precedence one (most serious / most informative) to drive the row's
// reported category. Ties are resolved in this order.
function classifyRow(r: RawRow): { category: CrimeCategory; description: string } {
  const yes = (v: string | undefined) => v === "1" || v === "true" || v === "TRUE";
  // PERSONS — order: Homicide > SexOffense > Robbery > AssaultOffense
  if (yes(r.Homicide))       return { category: CrimeCategory.PERSONS,  description: "HOMICIDE" };
  if (yes(r.SexOffense))     return { category: CrimeCategory.PERSONS,  description: "SEX OFFENSE" };
  if (yes(r.Robbery))        return { category: CrimeCategory.PERSONS,  description: "ROBBERY" };
  if (yes(r.AssaultOffense)) return { category: CrimeCategory.PERSONS,  description: "ASSAULT" };
  // PROPERTY — order: Arson > Burglary > VehicleTheft > Theft > CriminalDamage > LockedVehicle
  if (yes(r.Arson))          return { category: CrimeCategory.PROPERTY, description: "ARSON" };
  if (yes(r.Burglary))       return { category: CrimeCategory.PROPERTY, description: "BURGLARY" };
  if (yes(r.VehicleTheft))   return { category: CrimeCategory.PROPERTY, description: "MOTOR VEHICLE THEFT" };
  if (yes(r.Theft))          return { category: CrimeCategory.PROPERTY, description: "THEFT" };
  if (yes(r.CriminalDamage)) return { category: CrimeCategory.PROPERTY, description: "CRIMINAL DAMAGE" };
  if (yes(r.LockedVehicle))  return { category: CrimeCategory.PROPERTY, description: "LOCKED VEHICLE ENTRY" };
  // SOCIETY fallback if no flag set — shouldn't normally happen but
  // we'd rather render the row than drop it silently.
  return { category: CrimeCategory.SOCIETY, description: "OTHER" };
}

function parseDateMaybe(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

interface DatastoreResp { success?: boolean; result?: { records?: RawRow[]; total?: number } }

async function fetchPage(offset: number, signal?: AbortSignal): Promise<RawRow[]> {
  const url = `${DATASTORE_API}?resource_id=${MILWAUKEE_RESOURCE_ID}` +
    `&limit=${PAGE_SIZE}&offset=${offset}&sort=${encodeURIComponent("_id desc")}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Milwaukee datastore ${res.status} at offset ${offset}`);
  const body = (await res.json()) as DatastoreResp;
  return body.result?.records ?? [];
}

interface Cache { fetchedAt: number; rows: Incident[]; areas: KnownArea[] }
let cache: Cache | null = null;
let lastDiscovered: { fetchedAt: number; areas: KnownArea[] } | null = null;

// Static seed of all known Milwaukee ZIPs so a cold instance always has
// areas to show, matching the Phoenix adapter's defensive pattern.
const STATIC_MILWAUKEE_AREAS: KnownArea[] = Object.entries(ZIP_NEIGHBORHOOD).map(([zip, label]) => ({
  slug: `mke-${zip}`,
  label: `${label} (${zip})`,
  jurisdiction: "Milwaukee",
  centroid: { lat: 43.0389, lng: -87.9065 },
}));

async function fetchAndParse(): Promise<Cache> {
  // Try one big page first; if it returns the full count we're done.
  // The dataset is ~9.4k rows so one PAGE_SIZE=10k fetch covers it.
  const rawRows = await fetchPage(0).catch((err) => {
    console.warn("[milwaukee] fetchPage failed:", (err as Error).message);
    return [] as RawRow[];
  });

  const milwaukeeCentroid = { lat: 43.0389, lng: -87.9065 };
  const rows: Incident[] = [];
  const zipCounts = new Map<string, number>();
  for (const r of rawRows) {
    const occurred = parseDateMaybe(r.ReportedDateTime);
    if (!occurred) continue;
    const zip = (r.ZIP ?? "").trim();
    if (!/^\d{5}$/.test(zip)) continue;
    const slug = `mke-${zip}`;
    const { category, description } = classifyRow(r);
    rows.push({
      id: `mke-${r.IncidentNum ?? `${rows.length}`}`,
      area: slug,
      occurredAt: occurred.toISOString(),
      nibrsCategory: category,
      ibrOffenseDescription: description,
      beat: null,
      blockLabel: r.Location ?? undefined,
    });
    zipCounts.set(zip, (zipCounts.get(zip) ?? 0) + 1);
  }

  const areas: KnownArea[] = Array.from(zipCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([zip]) => ({
      slug: `mke-${zip}`,
      label: ZIP_NEIGHBORHOOD[zip] ?? `Milwaukee ${zip}`,
      jurisdiction: "Milwaukee",
      centroid: milwaukeeCentroid,
    }));

  return { fetchedAt: Date.now(), rows, areas };
}

async function getCached(): Promise<Cache | null> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache;
  try {
    const fresh = await fetchAndParse();
    cache = fresh;
    if (fresh.areas.length > 0) lastDiscovered = { fetchedAt: now, areas: fresh.areas };
    return fresh;
  } catch (err) {
    console.warn("[milwaukee] fetchAndParse failed:", (err as Error).message);
    return cache;
  }
}

export async function getDiscoveredAreas(): Promise<KnownArea[]> {
  const c = await getCached();
  if (c && c.areas.length > 0) return c.areas;
  if (lastDiscovered) return lastDiscovered.areas;
  // Static floor — guaranteed non-empty so the picker always has options
  // and per-area safety-score calls don't 404 on a cold instance.
  return STATIC_MILWAUKEE_AREAS;
}

export { getDiscoveredAreas as getDiscoveredAreasMilwaukee };

export const milwaukeeAdapter: CrimeDataAdapter = {
  name: "milwaukee-ckan",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const c = await getCached();
    if (!c) return null;
    const incs = c.rows.filter((r) => r.area === area);
    if (incs.length === 0) return null;
    const zip = area.replace(/^mke-/, "");
    return {
      area: ZIP_NEIGHBORHOOD[zip] ?? `Milwaukee ${zip}`,
      crimeRate: null,
      violentCrimeRate: null,
      propertyCrimeRate: null,
      riskLevel: (
        incs.length > 500 ? 5 :
        incs.length > 200 ? 4 :
        incs.length > 80  ? 3 :
        incs.length > 20  ? 2 : 1
      ) as 1 | 2 | 3 | 4 | 5,
      provenance: PROVENANCE,
    };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const c = await getCached();
    if (!c) return [];
    let filtered = c.rows.filter((r) => r.area === area);
    if (opts?.since) {
      const cutoff = +opts.since;
      filtered = filtered.filter((r) => +new Date(r.occurredAt) >= cutoff);
    }
    if (opts?.limit && filtered.length > opts.limit) filtered = filtered.slice(0, opts.limit);
    return filtered;
  },

  async getRecentReports(area: string, opts?: { limit?: number }) {
    const c = await getCached();
    if (!c) return [];
    const filtered = c.rows.filter((r) => r.area === area);
    return filtered.slice(0, opts?.limit ?? 50);
  },
};
