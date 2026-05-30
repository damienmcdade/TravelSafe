import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import type { KnownArea } from "../neighborhoods.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import { phoenixPolygons } from "../data/phoenix-neighborhoods.js";

// Per-village centroid lookup, derived from the bundled official
// Phoenix Urban Village polygons. Used as the centroid for every
// village area (Phoenix crime rows don't have lat/lng so we use the
// polygon center as the representative point for the entire village).
const VILLAGE_CENTROID: Record<string, { lat: number; lng: number }> =
  Object.fromEntries(phoenixPolygons.map((p) => [p.name, p.centroid]));

// Phoenix AZ — Phoenix Police Crime Statistics on phoenixopendata.com.
//
// The dataset is published as CSV (~75 MB, 624k+ rows back to late 2015)
// but the CKAN portal also exposes datastore_search which lets us
// paginate without downloading the full file. We pull the newest 50k
// rows in 5 parallel requests of 10k each — covers roughly the last 9
// months of Phoenix crime activity, well past the 12-week trend
// window the SafeZone tab uses.
//
// Areas: Phoenix PD publishes incidents tagged by ZIP code rather than
// by named neighborhood. We use ZIP as the area unit and attach
// friendly Phoenix urban-village labels (Downtown, Camelback East,
// Ahwatukee, etc.) where the ZIP maps to one cleanly. Unknown ZIPs
// fall back to "Phoenix 85xxx" so every area still has a slug.

const PHOENIX_RESOURCE_ID = "0ce3411a-2fc6-4302-a33f-167f68608a20";
const DATASTORE_API = "https://www.phoenixopendata.com/api/3/action/datastore_search";
const PAGE_SIZE = 10_000;
// v57 bump 5 → 20 (50k → 200k rows). Phoenix publishes ~200k
// incidents/year via UCR; the prior 50k cache covered only ~3
// months of data. v32's 5th-percentile windowDays trim couldn't
// help because rows were evenly distributed across the year (the
// trim is designed for bimodal outlier rows, not steady density).
// Result: dataEarliestMs landed ~1 year ago → windowDays=364 →
// annualization of the partial 50k count under-stated Phoenix's
// rate by 4-5×, tripping the v25 divergence guard. With 200k
// rows we capture roughly the full year.
const PAGES_TO_FETCH = 20;
const CACHE_TTL_MS = 10 * 60 * 1000;

interface RawRow {
  "INC NUMBER"?: string | null;
  "OCCURRED ON"?: string | null;
  "OCCURRED TO"?: string | null;
  "UCR CRIME CATEGORY"?: string | null;
  "100 BLOCK ADDR"?: string | null;
  "ZIP"?: string | null;
  "PREMISE TYPE"?: string | null;
  "GRID"?: string | null;
}

// Major Phoenix ZIPs → recognized neighborhood / urban village name.
// Sourced from Phoenix's official Urban Villages map + commonly used
// community profiles. Public knowledge, not derived from the police
// feed. Unknown ZIPs render as "Phoenix 85xxx" via the fallback path.
// Phoenix ZIP → official Phoenix urban-village name. Phoenix's 15
// urban villages are the city's actual published planning units
// (https://maps.phoenix.gov/pub/rest/services/Public/Villages); the
// polygon data is bundled in src/server/data/phoenix-neighborhoods.ts.
// Each ZIP falls in exactly one village (with minor edge cases for
// ZIPs that straddle the city boundary — picked the dominant village).
// Multiple ZIPs map to the same village (e.g. all five Maryvale ZIPs
// collapse to "Maryvale"); the discovery code aggregates by village
// so users see real Phoenix-planning names instead of derived ZIP
// labels.
const ZIP_TO_VILLAGE: Record<string, string> = {
  "85003": "Central City",
  "85004": "Central City",
  "85006": "Encanto",
  "85007": "Central City",
  "85008": "Encanto",
  "85009": "Maryvale",
  "85013": "Encanto",
  "85014": "Camelback East",
  "85015": "Alhambra",
  "85016": "Camelback East",
  "85017": "Alhambra",
  "85018": "Camelback East",
  "85019": "Maryvale",
  "85020": "North Mountain",
  "85021": "North Mountain",
  "85022": "Paradise Valley",
  "85023": "Deer Valley",
  "85024": "Desert View",
  "85027": "Deer Valley",
  "85028": "Paradise Valley",
  "85029": "North Mountain",
  "85031": "Maryvale",
  "85032": "Paradise Valley",
  "85033": "Maryvale",
  "85034": "South Mountain",
  "85035": "Maryvale",
  "85037": "Estrella",
  "85040": "South Mountain",
  "85041": "South Mountain",
  "85042": "South Mountain",
  "85043": "Laveen",
  "85044": "Ahwatukee Foothills",
  "85045": "Ahwatukee Foothills",
  "85048": "Ahwatukee Foothills",
  "85050": "Desert View",
  "85051": "North Mountain",
  "85053": "Deer Valley",
  "85054": "Desert View",
  "85083": "Deer Valley",
  "85085": "North Gateway",
};

const PROVENANCE: DataProvenance = {
  source: "Phoenix Police Crime Statistics · phoenixopendata.com",
  datasetUrl: "https://www.phoenixopendata.com/dataset/crime-data",
  recency: "Weekly publication; aggregated to ZIP",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Phoenix Police Department, aggregated to ZIP-level " +
    "neighborhood groupings. Not live, not street-level. CommunitySafe does not track individuals.",
};

// Phoenix dates: "M/D/YYYY  H:MM:SSAM/PM" (note the double-space between
// date and time on most rows). Native Date() parses most variants but
// we collapse internal whitespace first to keep it tolerant.
function parsePhoenixDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  // v62 — normalize to "M/D/YYYY H:MM:SS AM/PM". Phoenix's feed mixes
  // two formats: older rows have "9/3/2025  6:55:00 AM" (space before
  // AM/PM, parseable by Date()), but rows added since ~late-2025 use
  // "12/24/2025   6:58:00PM" — the AM/PM is jammed against the
  // seconds, which Date() rejects as Invalid Date. Whole-cache effect:
  // every Phoenix record published after the format change was silently
  // dropped by parsePhoenixDate, which is why our citywide cache held
  // 168k rows but the newest date was 2025-09-03 (the last day of the
  // old format). Insert a space before AM/PM so both formats parse.
  const cleaned = raw
    .replace(/\s+/g, " ")
    .replace(/(\d)(AM|PM|am|pm)\b/, "$1 $2")
    .trim();
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Phoenix uses legacy UCR Part I/II categories (not NIBRS Crime
// Against). Map the strings we see in the feed to the three NIBRS
// buckets the rest of the app expects.
function mapUcrToNibrs(ucr: string | null | undefined): CrimeCategory {
  const u = (ucr ?? "").trim().toUpperCase();
  if (
    u.includes("MURDER") || u.includes("HOMICIDE") || u.includes("RAPE") ||
    u.includes("ROBBERY") || u.includes("ASSAULT") || u.includes("KIDNAP") ||
    u.includes("SEX OFFENSE") || u.includes("OFFENSES AGAINST FAMILY")
  ) return CrimeCategory.PERSONS;
  if (
    u.includes("LARCENY") || u.includes("THEFT") || u.includes("BURGLARY") ||
    u.includes("MOTOR VEHICLE") || u.includes("ARSON") || u.includes("VANDALISM") ||
    u.includes("FRAUD") || u.includes("FORGERY")
  ) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

interface DatastoreResp { success?: boolean; result?: { records?: RawRow[] } }

async function fetchPage(offset: number, signal?: AbortSignal): Promise<RawRow[]> {
  // sort=_id desc returns newest rows first. _id is monotonic with
  // insert order which closely tracks incident occurred-at for this
  // dataset.
  const url = `${DATASTORE_API}?resource_id=${PHOENIX_RESOURCE_ID}` +
    `&limit=${PAGE_SIZE}&offset=${offset}&sort=${encodeURIComponent("_id desc")}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Phoenix datastore ${res.status} at offset ${offset}`);
  const body = (await res.json()) as DatastoreResp;
  return body.result?.records ?? [];
}

interface Cache {
  fetchedAt: number;
  rows: Incident[];
  areas: KnownArea[];
}
let cache: Cache | null = null;
registerRowCache(() => { cache = null; });
// Last-known-good areas. Independent of `cache` so a transient upstream
// failure doesn't blank the neighborhood list — same pattern SDPD uses.
let lastDiscovered: { fetchedAt: number; areas: KnownArea[] } | null = null;

async function fetchAndParse(): Promise<Cache> {
  const offsets = Array.from({ length: PAGES_TO_FETCH }, (_, i) => i * PAGE_SIZE);
  const pages = await Promise.all(
    offsets.map((o) => fetchPage(o).catch((err) => {
      console.warn(`[phoenix] page offset=${o} failed:`, (err as Error).message);
      return [] as RawRow[];
    })),
  );
  const rawRows = pages.flat();

  const rows: Incident[] = [];
  const villageCounts = new Map<string, number>();
  // Phoenix metro centroid — last-resort fallback for ZIPs that
  // don't map to any village (shouldn't happen for in-city PD rows,
  // but the discovery code must still produce a valid centroid).
  const PHOENIX_METRO_CENTROID = { lat: 33.45, lng: -112.07 };

  for (const r of rawRows) {
    const occurred = parsePhoenixDate(r["OCCURRED ON"]);
    if (!occurred) continue;
    const zip = (r["ZIP"] ?? "").trim();
    if (!/^\d{5}$/.test(zip)) continue;
    // Aggregate by village. Unmapped ZIPs fall back to the legacy
    // "Phoenix 85xxx" label so the row isn't dropped — discovery
    // still surfaces it as a known area.
    const village = ZIP_TO_VILLAGE[zip] ?? `Phoenix ${zip}`;
    rows.push({
      id: `phx-${r["INC NUMBER"] ?? `${rows.length}`}`,
      area: village,
      occurredAt: occurred.toISOString(),
      nibrsCategory: mapUcrToNibrs(r["UCR CRIME CATEGORY"]),
      ibrOffenseDescription: (r["UCR CRIME CATEGORY"] ?? "Unknown").trim(),
      beat: r["GRID"] ?? null,
      blockLabel: r["100 BLOCK ADDR"] ?? undefined,
    });
    villageCounts.set(village, (villageCounts.get(village) ?? 0) + 1);
  }

  // v82 — suppress "Phoenix 85xxx" ZIP-fallback labels from the
  // discover surface. Same pattern as DC ward-fallback suppression:
  // they have no matching polygon (the polygon file is the 15 official
  // urban villages) and showed up as 61 orphan picker entries with no
  // map representation. Incidents at unmapped ZIPs still count toward
  // citywide totals (they're already in `rows`), we just don't expose
  // them as standalone area choices.
  const areas: KnownArea[] = Array.from(villageCounts.entries())
    .filter(([village]) => !/^Phoenix \d{5}$/.test(village))
    .sort((a, b) => b[1] - a[1])
    .map(([village]) => ({
      slug: `phx-${village.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: village,
      jurisdiction: "Phoenix",
      centroid: VILLAGE_CENTROID[village] ?? PHOENIX_METRO_CENTROID,
    }));

  return { fetchedAt: Date.now(), rows, areas };
}

async function getCached(): Promise<Cache | null> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache;
  try {
    const fresh = await fetchAndParse();
    cache = fresh;
    if (fresh.areas.length > 0) {
      lastDiscovered = { fetchedAt: now, areas: fresh.areas };
    }
    return fresh;
  } catch (err) {
    console.warn("[phoenix] fetchAndParse failed:", (err as Error).message);
    return cache;
  }
}

/// Static seed list derived from ZIP_NEIGHBORHOOD. Used as the floor
/// for getDiscoveredAreas() so a cold Vercel instance (where the
/// in-memory cache is empty and the live datastore fetch hasn't
/// completed yet) never returns []. Without this the SafeZone area
/// picker showed 0 Phoenix neighborhoods on every fresh instance, and
/// /api/safezone/safety-score?area=phx-... 404'd as "unknown_area"
// Static fallback: every village from the polygon dataset gets a
// slug entry. Guarantees the picker always has options + lookups
// resolve on a cold instance before the first fetch lands.
function villageSlug(name: string): string {
  return `phx-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}
const STATIC_PHOENIX_AREAS: KnownArea[] = phoenixPolygons.map((p) => ({
  slug: villageSlug(p.name),
  label: p.name,
  jurisdiction: "Phoenix",
  centroid: p.centroid,
}));

export async function getDiscoveredAreas(): Promise<KnownArea[]> {
  const c = await getCached();
  if (c && c.areas.length > 0) return c.areas;
  if (lastDiscovered) return lastDiscovered.areas;
  return STATIC_PHOENIX_AREAS;
}

// Re-export with the city-prefixed name the cities.ts registry expects.
export { getDiscoveredAreas as getDiscoveredAreasPhoenix };

/// Resolve a Phoenix area slug ("phx-central-city") to its actual
/// village name ("Central City") as stored on r.area. Falls back to
/// the legacy "phx-85003" → "Phoenix 85003" path for unmapped ZIPs.
function labelForPhxSlug(slug: string): string {
  const want = slug.replace(/^phx-/, "");
  // ZIP-style legacy slug: "phx-85003"
  if (/^\d{5}$/.test(want)) {
    return ZIP_TO_VILLAGE[want] ?? `Phoenix ${want}`;
  }
  // Modern slug derived from village name. Search the polygon list.
  const hit = phoenixPolygons.find((p) => villageSlug(p.name) === slug);
  return hit?.name ?? slug;
}

export const phoenixAdapter: CrimeDataAdapter = {
  name: "phoenix-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const c = await getCached();
    if (!c) return null;
    const label = labelForPhxSlug(area);
    const incs = c.rows.filter((r) => r.area === label);
    if (incs.length === 0) return null;
    return {
      area: label,
      crimeRate: null,
      violentCrimeRate: null,
      propertyCrimeRate: null,
      // Self-calibrating quintile bands over Phoenix's own per-village
      // distribution; degrades to the prior per-village thresholds (15
      // villages vs 41 ZIPs — each village ~3x the ZIP-level count).
      riskLevel: riskLevelFromAreaCounts(c.rows, incs.length, [150, 600, 2400, 6000]),
      provenance: PROVENANCE,
    };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const c = await getCached();
    if (!c) return [];
    const label = labelForPhxSlug(area);
    let filtered = c.rows.filter((r) => r.area === label);
    if (opts?.since) {
      const cutoff = +opts.since;
      filtered = filtered.filter((r) => +new Date(r.occurredAt) >= cutoff);
    }
    if (opts?.limit && filtered.length > opts.limit) {
      filtered = filtered.slice(0, opts.limit);
    }
    return filtered;
  },

  async getRecentReports(area: string, opts?: { limit?: number }) {
    const c = await getCached();
    if (!c) return [];
    const label = labelForPhxSlug(area);
    const filtered = c.rows.filter((r) => r.area === label);
    // v95p35 — sort newest-first so the Recent-Incidents card renders
    // in chronological order. Sister adapters all sort here; Phoenix
    // + Milwaukee were the only outliers.
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
};
