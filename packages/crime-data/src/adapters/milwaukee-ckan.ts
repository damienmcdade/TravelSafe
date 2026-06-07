import { CrimeCategory } from "../crime-category.js";
import { readJson } from "../lib/http.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";
import { registerRowCache } from "../cache-registry.js";
import type { KnownArea } from "../neighborhoods.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";

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

import { milwaukeePolygons } from "../data/milwaukee-neighborhoods.js";

// Per-neighborhood centroid lookup from the bundled DCD polygon set.
// Used as the centroid for every area (Milwaukee crime rows lack
// lat/lng so the polygon center is the representative point).
const MKE_CENTROID: Record<string, { lat: number; lng: number }> =
  Object.fromEntries(milwaukeePolygons.map((p) => [p.name, p.centroid]));

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
//
// fix(audit cov-mke-geojson-vs-datafile-divergence): the prior comment claimed
// these names "match entries in the bundled ... dataset (190 official MKE DCD
// neighborhoods)". That overstated the grain — Milwaukee's feed only carries a
// ZIP per incident, so the adapter buckets by ZIP into ~30-40 ZIP-level areas,
// each LABELLED with a representative neighborhood name (chosen so a real polygon
// centroid can be pulled where one exists). It does NOT resolve incidents to the
// 190 DCD neighborhood polygons — that resolution isn't in the source data.
// ZIPs that straddle the city boundary (53217 Fox Point, 53220 Greenfield, etc.)
// map to the closest in-city name — MPD jurisdiction only extends to the city
// portions of those ZIPs.
const ZIP_NEIGHBORHOOD: Record<string, string> = {
  "53202": "Juneau Town",
  "53203": "Kilbourn Town",
  "53204": "Walker's Point",
  "53205": "Concordia",
  "53206": "Sherman Park",
  "53207": "Bay View",
  "53208": "Washington Park",
  "53209": "Granville Station",
  "53210": "Park West",
  "53211": "Upper East Side",
  "53212": "Riverwest",
  "53213": "West Town",
  "53214": "Story Hill",
  "53215": "Lincoln Village",
  "53216": "Sherman Park",
  "53217": "Bayside",
  "53218": "Capitol Heights",
  "53219": "Jackson Park",
  "53220": "Goldmann",
  "53221": "Tippecanoe",
  "53222": "Capitol Heights",
  "53223": "Brown Deer",
  "53224": "Granville",
  "53225": "Northridge Lakes",
  "53226": "Story Hill",
  "53227": "West Allis",
  "53228": "Greenfield",
  "53233": "Avenues West",
};

// ZIPs whose footprint is overwhelmingly a SEPARATE municipality with its own
// police department — the MPD WIBR feed carries only a stray boundary sliver,
// so grading them as Milwaukee neighborhoods is both data-poor (N/A) and
// misleading (they're labeled after the suburb). Excluded from aggregation.
// 53227 West Allis · 53228 Greenfield · 53223 Brown Deer.
const NON_MPD_ZIPS: ReadonlySet<string> = new Set(["53227", "53228", "53223"]);

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
  // v99 — was `new Date(raw.replace(" ","T") + "Z")`, which asserted
  // Milwaukee local wall-clock IS UTC and shifted every incident ~5-6h.
  // cityLocalToUtcIso converts the Central wall-clock to the true instant.
  const d = new Date(cityLocalToUtcIso(raw, "America/Chicago"));
  return d.getTime() <= 0 ? null : d;
}

interface DatastoreResp { success?: boolean; result?: { records?: RawRow[]; total?: number } }

async function fetchPage(offset: number, signal?: AbortSignal): Promise<RawRow[]> {
  const url = `${DATASTORE_API}?resource_id=${MILWAUKEE_RESOURCE_ID}` +
    `&limit=${PAGE_SIZE}&offset=${offset}&sort=${encodeURIComponent("_id desc")}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Milwaukee datastore ${res.status} at offset ${offset}`);
  const body = (await readJson(res)) as DatastoreResp;
  return body.result?.records ?? [];
}

interface Cache { fetchedAt: number; rows: Incident[]; areas: KnownArea[] }
let cache: Cache | null = null;
registerRowCache(() => { cache = null; }, "milwaukee-ckan");
let lastDiscovered: { fetchedAt: number; areas: KnownArea[] } | null = null;

// Milwaukee metro centroid — last-resort fallback when a neighborhood
// name doesn't exist in the bundled polygon set (suburbs that the
// ZIP-to-neighborhood map points to, edge cases).
const MILWAUKEE_METRO_CENTROID = { lat: 43.0389, lng: -87.9065 };

function nbhSlug(name: string): string {
  return `mke-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

// Static seed — every Milwaukee neighborhood from the polygon dataset
// becomes an area entry. Guarantees cold instances always have the
// full neighborhood list ready for the picker.
const STATIC_MILWAUKEE_AREAS: KnownArea[] = milwaukeePolygons.map((p) => ({
  slug: nbhSlug(p.name),
  label: p.name,
  jurisdiction: "Milwaukee",
  centroid: p.centroid,
}));

async function fetchAndParse(): Promise<Cache> {
  // Try one big page first; if it returns the full count we're done.
  // The dataset is ~9.4k rows so one PAGE_SIZE=10k fetch covers it.
  const rawRows = await fetchPage(0).catch((err) => {
    console.warn("[milwaukee] fetchPage failed:", (err as Error).message);
    return [] as RawRow[];
  });

  const rows: Incident[] = [];
  const nbhCounts = new Map<string, number>();
  for (const r of rawRows) {
    const occurred = parseDateMaybe(r.ReportedDateTime);
    if (!occurred) continue;
    const zip = (r.ZIP ?? "").trim();
    if (!/^\d{5}$/.test(zip)) continue;
    if (NON_MPD_ZIPS.has(zip)) continue;
    // v106 — aggregate ONLY by ZIPs that map to a real, recognizable
    // Milwaukee neighborhood. Previously an unmapped ZIP fell back to a raw
    // "Milwaukee 53xxx" label, which (a) is an unrecognizable name and
    // (b) surfaced suburb/PO-box ZIP slivers as dataless N/A "neighborhoods"
    // (West Allis 53227, Greenfield 53228, Oak Creek 53154, …) that dragged
    // coverage to 67%. Drop the sliver rows instead — they're a negligible
    // fraction and can't be placed in a recognizable area anyway.
    const nbh = ZIP_NEIGHBORHOOD[zip];
    if (!nbh) continue;
    const { category, description } = classifyRow(r);
    rows.push({
      id: `mke-${r.IncidentNum ?? `${rows.length}`}`,
      area: nbh,
      occurredAt: occurred.toISOString(),
      nibrsCategory: category,
      ibrOffenseDescription: description,
      beat: null,
      blockLabel: r.Location ?? undefined,
    });
    nbhCounts.set(nbh, (nbhCounts.get(nbh) ?? 0) + 1);
  }

  const areas: KnownArea[] = Array.from(nbhCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([nbh]) => ({
      slug: nbhSlug(nbh),
      label: nbh,
      jurisdiction: "Milwaukee",
      centroid: MKE_CENTROID[nbh] ?? MILWAUKEE_METRO_CENTROID,
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

/// Resolve a Milwaukee area slug ("mke-bay-view") to the actual
/// neighborhood label as stored on r.area. Legacy ZIP-style slugs
/// ("mke-53202") map via ZIP_NEIGHBORHOOD.
function labelForMkeSlug(slug: string): string {
  const want = slug.replace(/^mke-/, "");
  if (/^\d{5}$/.test(want)) {
    return ZIP_NEIGHBORHOOD[want] ?? `Milwaukee ${want}`;
  }
  const hit = milwaukeePolygons.find((p) => nbhSlug(p.name) === slug);
  return hit?.name ?? slug;
}

export const milwaukeeAdapter: CrimeDataAdapter = {
  name: "milwaukee-ckan",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const c = await getCached();
    if (!c) return null;
    const label = labelForMkeSlug(area);
    const incs = c.rows.filter((r) => r.area === label);
    if (incs.length === 0) return null;
    return {
      area: label,
      crimeRate: null,
      violentCrimeRate: null,
      propertyCrimeRate: null,
      // Self-calibrating quintile bands over Milwaukee's own
      // per-neighborhood distribution; degrades to the prior thresholds.
      riskLevel: riskLevelFromAreaCounts(c.rows, incs.length, [20, 80, 200, 500]),
      provenance: PROVENANCE,
    };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const c = await getCached();
    if (!c) return [];
    const label = labelForMkeSlug(area);
    let filtered = c.rows.filter((r) => r.area === label);
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
    const label = labelForMkeSlug(area);
    const filtered = c.rows.filter((r) => r.area === label);
    // v95p35 — sort newest-first so the Recent-Incidents card renders
    // in chronological order. Sister adapters all sort here; Phoenix
    // + Milwaukee were the only outliers.
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
};
