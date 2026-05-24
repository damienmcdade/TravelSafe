import "server-only";
import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";

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
const PAGES_TO_FETCH = 5;
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
const ZIP_NEIGHBORHOOD: Record<string, string> = {
  "85003": "Downtown Phoenix",
  "85004": "Downtown East",
  "85006": "Garfield",
  "85007": "Capitol",
  "85008": "Eastlake Park",
  "85009": "Maryvale East",
  "85013": "Encanto",
  "85014": "North Central",
  "85015": "Encanto Fairway",
  "85016": "Camelback East",
  "85017": "Estrella",
  "85018": "Arcadia",
  "85019": "Maryvale",
  "85020": "North Mountain",
  "85021": "Sunnyslope",
  "85022": "Paradise Valley South",
  "85023": "Deer Valley",
  "85024": "Tatum Ranch",
  "85027": "Anthem South",
  "85028": "Paradise Valley Village",
  "85029": "Moon Valley",
  "85031": "Maryvale Central",
  "85032": "Paradise Valley",
  "85033": "Maryvale West",
  "85034": "South Mountain North",
  "85035": "Maryvale Far West",
  "85037": "Estrella West",
  "85040": "South Mountain Village",
  "85041": "South Mountain South",
  "85042": "Ahwatukee",
  "85043": "Laveen",
  "85044": "Ahwatukee Foothills",
  "85045": "Ahwatukee North",
  "85048": "Ahwatukee Lakes",
  "85050": "Desert Ridge",
  "85051": "Moon Valley West",
  "85053": "Deer Valley West",
  "85054": "Desert Ridge East",
  "85083": "Anthem North",
  "85085": "Anthem East",
  "85086": "Cave Creek",
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
  const cleaned = raw.replace(/\s+/g, " ").trim();
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
  const zipCounts = new Map<string, number>();
  for (const r of rawRows) {
    const occurred = parsePhoenixDate(r["OCCURRED ON"]);
    if (!occurred) continue;
    const zip = (r["ZIP"] ?? "").trim();
    if (!/^\d{5}$/.test(zip)) continue;
    const slug = `phx-${zip}`;
    rows.push({
      id: `phx-${r["INC NUMBER"] ?? `${rows.length}`}`,
      area: slug,
      occurredAt: occurred.toISOString(),
      nibrsCategory: mapUcrToNibrs(r["UCR CRIME CATEGORY"]),
      ibrOffenseDescription: (r["UCR CRIME CATEGORY"] ?? "Unknown").trim(),
      beat: r["GRID"] ?? null,
      blockLabel: r["100 BLOCK ADDR"] ?? undefined,
    });
    zipCounts.set(zip, (zipCounts.get(zip) ?? 0) + 1);
  }

  // Order areas by incident volume so the wheel surfaces the busiest
  // (most user-recognizable) neighborhoods first when search is empty.
  // Centroid is the Phoenix metro center — we don't compute per-ZIP
  // centroids because lat/lng isn't in this dataset.
  const phoenixCentroid = { lat: 33.45, lng: -112.07 };
  const areas: KnownArea[] = Array.from(zipCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([zip]) => ({
      slug: `phx-${zip}`,
      label: ZIP_NEIGHBORHOOD[zip] ?? `Phoenix ${zip}`,
      jurisdiction: "Phoenix",
      centroid: phoenixCentroid,
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
/// for valid Phoenix slugs the user picked from coverage / cities pages.
const STATIC_PHOENIX_AREAS: KnownArea[] = Object.entries(ZIP_NEIGHBORHOOD).map(([zip, label]) => ({
  slug: `phx-${zip}`,
  label: `${label} (${zip})`,
  jurisdiction: "Phoenix",
  centroid: { lat: 33.45, lng: -112.07 },
}));

export async function getDiscoveredAreas(): Promise<KnownArea[]> {
  const c = await getCached();
  if (c && c.areas.length > 0) return c.areas;
  if (lastDiscovered) return lastDiscovered.areas;
  // Static floor — guaranteed non-empty so the picker always has options
  // and per-area safety-score calls don't 404 on a cold instance.
  return STATIC_PHOENIX_AREAS;
}

// Re-export with the city-prefixed name the cities.ts registry expects.
export { getDiscoveredAreas as getDiscoveredAreasPhoenix };

export const phoenixAdapter: CrimeDataAdapter = {
  name: "phoenix-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const c = await getCached();
    if (!c) return null;
    const incs = c.rows.filter((r) => r.area === area);
    if (incs.length === 0) return null;
    const zip = area.replace(/^phx-/, "");
    return {
      area: ZIP_NEIGHBORHOOD[zip] ?? `Phoenix ${zip}`,
      // Per-1,000 rates would require a per-ZIP population denominator
      // we don't carry today. Leave null and let the higher-level
      // citywide aggregator handle ratemath against the Census total.
      crimeRate: null,
      violentCrimeRate: null,
      propertyCrimeRate: null,
      riskLevel: (
        incs.length > 2000 ? 5 :
        incs.length > 800  ? 4 :
        incs.length > 200  ? 3 :
        incs.length > 50   ? 2 : 1
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
    if (opts?.limit && filtered.length > opts.limit) {
      // Keep the MOST RECENT `limit` rows. Rows arrive sorted newest-
      // first from the datastore so slice from the head.
      filtered = filtered.slice(0, opts.limit);
    }
    return filtered;
  },

  async getRecentReports(area: string, opts?: { limit?: number }) {
    const c = await getCached();
    if (!c) return [];
    // Rows are already sorted newest-first by fetch order.
    const filtered = c.rows.filter((r) => r.area === area);
    return filtered.slice(0, opts?.limit ?? 50);
  },
};
