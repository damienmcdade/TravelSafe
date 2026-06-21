import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT, readJson, fetchWithRetry } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";

// Durham, NC — Durham Police Department "City Crime (External Use)" feed,
// hosted on the City of Durham ArcGIS Server as a NON-SPATIAL MapServer TABLE
// (PublicServices/Tables/MapServer/4). The table carries NO per-incident
// coordinates — there is no geometry field at all — so incidents CANNOT be
// pinned on the Crime Map. The coarsest reliable location signal in the feed
// is the Durham PD response district (`DIST`, values "1".."5"), so we group
// incidents to one of the 5 police districts ("Durham District N"). This is a
// POLYGON-COUNT granularity adapter: areas are colored by their incident count,
// but no individual incident dots are drawn (Incident.lat/lng are undefined).
//
// Centroids for the 5 districts are derived once from the Durham Police
// Districts boundary polygon layer (DISTNUM / LAWDIST on Police/FeatureServer
// layer 9, vertex-averaged in WGS84) and hardcoded below so this adapter has no
// runtime dependency on the boundary service.
//
// Feed:     https://webgis2.durhamnc.gov/server/rest/services/PublicServices/Tables/MapServer/4
// Polygons: https://services2.arcgis.com/G5vR3cOjh6g2Ed8E/arcgis/rest/services/Police/FeatureServer/9 (Police Districts)

const BASE =
  "https://webgis2.durhamnc.gov/server/rest/services/PublicServices/Tables/MapServer/4/query";
const DURHAM_TZ = "America/New_York";
const PAGE_SIZE = 2000; // = server maxRecordCount
const WINDOW_DAYS = 400; // a touch over a year so the 365d score window is fully covered
// ~29k incidents observed over 400d across all 5 districts → 20 pages (40k)
// has comfortable headroom as the rolling window grows.
const PAGES = 20;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => {
  cache = null;
}, "durham-arcgis");

// Per-district centroids, vertex-averaged from the Police Districts polygon
// layer (DISTNUM 1-5 via LAWDIST D1..D5), WGS84 lat/lng. Durham PD has 5
// response districts; the rare blank-district row is a citywide catch-all and
// is excluded from discovery (it still counts toward the citywide total).
const DISTRICT_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  "1": { lat: 35.97812, lng: -78.81307 },
  "2": { lat: 36.11569, lng: -78.87815 },
  "3": { lat: 35.93898, lng: -78.97296 },
  "4": { lat: 35.91289, lng: -78.86079 },
  "5": { lat: 35.99684, lng: -78.90083 },
};

interface DurhamFeature {
  attributes: {
    OBJECTID?: number;
    INCI_ID?: string;
    DATE_REPT?: number; // epoch ms (report date-time)
    HOUR_REPT?: string; // "HHMM" 24h string, e.g. "2354"
    UCR_CODE?: string; // NIBRS-style alphanumeric code, e.g. "120 ", "23F " (NOT clean Part-1 numeric)
    CHRGDESC?: string; // human offense description, e.g. "ROBBERY - INDIVIDUAL"
    DIST?: string; // Durham PD district "1".."5" (rarely blank)
    BEAT?: string;
  };
}

// Classify by CHRGDESC: the UCR_CODE in this feed is the NIBRS-style
// alphanumeric code (120, 240, 90I, 23F, 26A, ...), NOT a clean Part-1 1-8
// numeric code, so the description is the cleaner signal. Crimes Against
// Persons / Property / Society. Robbery is filed by NIBRS under Property but
// the FBI UCR counts it as a Part-1 VIOLENT offense, so force it to PERSONS
// (same convention as the Long Beach / Dallas / Saint Paul adapters).
function classify(chrgDesc: string | undefined): CrimeCategory {
  const d = (chrgDesc ?? "").toUpperCase();
  if (d.includes("ROBBERY")) return CrimeCategory.PERSONS;
  if (
    d.includes("ASSAULT") ||
    d.includes("HOMICIDE") ||
    d.includes("MURDER") ||
    d.includes("MANSLAUGHTER") ||
    d.includes("KIDNAP") ||
    d.includes("ABDUCTION") ||
    d.includes("RAPE") ||
    d.includes("SEX OFFENSE") ||
    d.includes("SEXUAL") ||
    d.includes("FONDLING") ||
    d.includes("INDECENT LIBERTIES") ||
    d.includes("HUMAN TRAFFICK") ||
    d.includes("STALKING") ||
    d.includes("INTIMIDATION")
  ) {
    return CrimeCategory.PERSONS;
  }
  if (
    d.includes("BURGLARY") ||
    d.includes("BREAKING") ||
    d.includes("LARCENY") ||
    d.includes("THEFT") ||
    d.includes("STOLEN") ||
    d.includes("MOTOR VEHICLE") ||
    d.includes("ARSON") ||
    d.includes("VANDALISM") ||
    d.includes("DAMAGE") ||
    d.includes("DESTRUCTION") ||
    d.includes("FRAUD") ||
    d.includes("FORGERY") ||
    d.includes("COUNTERFEIT") ||
    d.includes("EMBEZZL") ||
    d.includes("EXTORTION") ||
    d.includes("BRIBERY") ||
    d.includes("SHOPLIFT")
  ) {
    return CrimeCategory.PROPERTY;
  }
  return CrimeCategory.SOCIETY;
}

function districtLabel(dist: string): string {
  return `Durham District ${dist}`;
}

function slugifyDistrict(dist: string): string {
  return `dur-district-${dist}`;
}

const PROVENANCE: DataProvenance = {
  source: "Durham Police Department (City of Durham ArcGIS — City Crime External Use)",
  datasetUrl: "https://webgis2.durhamnc.gov/server/rest/services/PublicServices/Tables/MapServer/4",
  recency: "Refreshed daily by the Durham Police Department (rolling incident feed)",
  granularity: "jurisdiction",
  disclaimer:
    "Incidents are reported by the Durham Police Department and grouped by Durham PD " +
    "response district (this feed carries no per-incident location, so incidents are not " +
    "mapped individually) — not live, not street-level. CommunitySafe does not track individuals.",
};

function occurredAtFor(dateReptMs: number | undefined, hourRept: string | undefined): string {
  if (typeof dateReptMs !== "number") return cityLocalToUtcIso(null, DURHAM_TZ);
  // DATE_REPT is the report instant (epoch ms). Extract the calendar date in
  // Durham local time, then attach HOUR_REPT ("HHMM") as the authoritative hour
  // and convert the wall-clock back to UTC.
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: DURHAM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(dateReptMs));
  const raw = (hourRept ?? "").trim().padStart(4, "0").slice(0, 4);
  let hh = Number(raw.slice(0, 2));
  if (!Number.isFinite(hh) || hh < 0 || hh > 23) {
    // Fall back to the hour embedded in the epoch (in Durham local time).
    hh = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: DURHAM_TZ, hour: "2-digit", hour12: false }).format(
        new Date(dateReptMs),
      ),
    );
    if (!Number.isFinite(hh) || hh > 23) hh = 0;
  }
  const hhStr = String(hh).padStart(2, "0");
  return cityLocalToUtcIso(`${ymd}T${hhStr}:00:00`, DURHAM_TZ);
}

async function fetchPage(offset: number, sinceTs: string): Promise<DurhamFeature[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", `DATE_REPT >= timestamp '${sinceTs}'`);
  url.searchParams.set("outFields", "OBJECTID,INCI_ID,DATE_REPT,HOUR_REPT,UCR_CODE,CHRGDESC,DIST,BEAT");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "DATE_REPT DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Durham ArcGIS ${res.status} offset=${offset}`);
  const body = (await readJson(res)) as { features?: DurhamFeature[]; error?: unknown };
  // Throw on the embedded ArcGIS error envelope (HTTP 200 + {error:{...}}) so a
  // failed/token-gated layer serves last-known-good instead of grading as zero-crime.
  if (body.error) throw new Error(`Durham ArcGIS body error offset=${offset}`);
  return body.features ?? [];
}

async function fetchDurham(): Promise<Incident[]> {
  const sinceTs = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  const results: DurhamFeature[][] = new Array(PAGES);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PAGES) return;
      results[i] = await fetchPage(i * PAGE_SIZE, sinceTs).catch(() => [] as DurhamFeature[]);
    }
  });
  await Promise.all(workers);
  const feats = results.flat();
  return feats
    .filter((f) => typeof f.attributes.DATE_REPT === "number" && (f.attributes.DIST ?? "").trim())
    .map((f, i) => {
      const a = f.attributes;
      const dist = (a.DIST ?? "").trim();
      return {
        id: `dur-${a.OBJECTID ?? a.INCI_ID ?? i}`,
        area: districtLabel(dist),
        occurredAt: occurredAtFor(a.DATE_REPT, a.HOUR_REPT),
        nibrsCategory: classify(a.CHRGDESC),
        ibrOffenseDescription: titleCaseOffense(a.CHRGDESC ?? "Unknown"),
        beat: (a.BEAT ?? "").trim() || null,
        blockLabel: undefined,
        // No per-incident coordinates in this feed — polygon-count only.
        lat: undefined,
        lng: undefined,
      } as Incident;
    });
}

// In-flight fetch dedup: the dispatcher fans a per-area Promise.all over every
// area, so a cold cache would otherwise fire N concurrent full fetches.
let inFlightFetch: Promise<Incident[]> | null = null;
export async function getRowsDurham(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightFetch) return inFlightFetch;
  inFlightFetch = (async () => {
    try {
      const rows = await fetchDurham();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[durham] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightFetch = null;
    }
  })();
  return inFlightFetch;
}

export async function getDiscoveredAreasDurham(): Promise<KnownArea[]> {
  const rows = await getRowsDurham();
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.area) continue;
    counts.set(r.area, (counts.get(r.area) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, c]) => c >= 3)
    .map(([label]) => {
      const dist = label.replace(/^Durham District /, "");
      const centroid = DISTRICT_CENTROIDS[dist];
      return centroid
        ? { slug: slugifyDistrict(dist), label, jurisdiction: "Durham", centroid }
        : null;
    })
    .filter((a): a is KnownArea => a !== null)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForSlug(slug: string, rows: Incident[]): string | null {
  const want = slug.toLowerCase();
  for (const r of rows) {
    const dist = r.area.replace(/^Durham District /, "");
    if (slugifyDistrict(dist) === want) return r.area;
  }
  return null;
}

export const durhamAdapter: CrimeDataAdapter = {
  name: "durham-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsDurham();
    const label = labelForSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    // Districts are large (5 cover the whole city) so the per-area bands are
    // scaled up relative to the neighborhood-granularity adapters.
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [800, 2000, 4000, 7000]);
    return {
      area: label,
      crimeRate: null,
      violentCrimeRate: null,
      propertyCrimeRate: null,
      riskLevel,
      provenance: PROVENANCE,
    };
  },
  async getIncidents(area, opts) {
    const rows = await getRowsDurham();
    const label = labelForSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area, opts) {
    return this.getIncidents(area, { limit: opts?.limit ?? 20 });
  },
};
