import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT, readJson, fetchWithRetry } from "../lib/http.js";

// Phoenix AZ — Phoenix PD Crime Data (phoenixopendata.com CKAN datastore).
//
// HONESTY NOTE — read before touching this adapter:
// Phoenix was REMOVED from the app once before for under-counting, so be
// careful. Upstream specifics (verified 2026):
//   * The CKAN resource is a single ever-growing table (~624k rows,
//     2015→present) that refreshes PERIODICALLY but with a multi-week
//     publication lag, so the newest occurrences trail real time. It is NOT a
//     once-a-year frozen snapshot (an earlier note claimed "frozen at
//     2025-12-31, updated about once a year" — that was wrong). We pull the
//     newest rows and keep a rolling ~18-month window (see WINDOW_DAYS), so
//     recency auto-tracks the feed instead of rotting at a hardcoded year.
//   * Geography is ZIP-ONLY. There is no lat/lng, no neighborhood, no beat.
//     The raw `ZIP` column is therefore the only locator. To make areas read
//     as recognizable places instead of bare 5-digit codes, we map each
//     Phoenix ZIP to its CITY OF PHOENIX URBAN VILLAGE — one of the 15
//     official planning villages (Maryvale, Camelback East, Central City,
//     Deer Valley, …). The mapping (ZIP_TO_VILLAGE below) was built by
//     overlaying the 78 ZCTA polygons in apps/web/public/geo against the
//     authoritative City of Phoenix "Villages" GIS layer
//     (maps.phoenix.gov/pub/rest/services/Public/Villages/MapServer/0,
//     NAME field) and assigning each ZIP to the village containing its ZCTA
//     centroid (plus two boundary ZIPs whose area is majority-Phoenix).
//     apps/web/public/geo/phoenix.geojson now carries those village polygons
//     (properties.name = village), so the Crime Map matches on village name.
//   * Not every ZCTA falls inside the City of Phoenix. The annual feed
//     includes a metro-wide spread of ZIPs; suburban ZIPs (Mesa/Scottsdale/
//     Glendale/Chandler/Tempe/Peoria/etc.) have no Phoenix village, and two
//     small fully-absorbed villages (Encanto, Laveen) have no ZIP whose
//     centroid lands inside them. A ZIP with no village mapping keeps its
//     bare ZIP string as its label (honest, never faked into a village).
//   * ~13% of 2025 rows carry a NULL / blank / literal-"NULL" / non-Phoenix
//     ZIP. Those are folded into a single honest "Unmapped" bucket rather
//     than dropped (so citywide totals stay complete) or faked. With the
//     village mapping, ~96% of rows that DO carry a Phoenix ZIP land in a
//     named village; the rest keep their ZIP label.
// Every one of these limits is surfaced verbatim in PROVENANCE below. Do NOT
// present this as live/street-level data — the publication lag means the
// newest incidents are several weeks behind real time.
//
// CKAN datastore_search:
//   https://www.phoenixopendata.com/api/3/action/datastore_search
//     ?resource_id=0ce3411a-2fc6-4302-a33f-167f68608a20&limit=&offset=
// Fields: "INC NUMBER", "OCCURRED ON", "UCR CRIME CATEGORY", "ZIP",
//         "100 BLOCK ADDR", "PREMISE TYPE", "GRID". 624,147 rows total
//         (2015→2025). We pull only the most-recent rows (sorted _id desc)
//         and keep those that OCCURRED in 2025 — the freshest full year the
//         snapshot contains.

const RESOURCE_ID = "0ce3411a-2fc6-4302-a33f-167f68608a20";
const DATASTORE_API = "https://www.phoenixopendata.com/api/3/action/datastore_search";
const PAGE_SIZE = 32_000;
// The newest rows in the snapshot are the most recent occurrences. Pulling
// ~96k of the newest _ids (3 pages) comfortably covers the ~50k incidents
// that occurred in calendar 2025 plus the lead-in tail, then we date-filter
// to the 2025 window below. Bounded so we never scan all 624k rows.
const PAGES = 3;
// The annual snapshot doesn't change between requests; a long TTL avoids
// needless re-pulls while still picking up the once-a-year refresh.
const CACHE_TTL_MS = 60 * 60 * 1000;

// v108 — ROLLING window (was a hardcoded Date.UTC(2025,0,1)). Verified 2026:
// the Phoenix CKAN resource is NOT a frozen annual snapshot — it refreshes
// periodically but with a multi-week publication lag. A hardcoded 2025 start
// would silently rot into a stale "most recent year" as the feed advances; a
// rolling ~18-month bound auto-tracks the freshest data present (the dispatcher
// derives the real windowDays from the data's own date range, so a generous
// bound here only avoids truncating).
const WINDOW_DAYS = 548;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

// Phoenix observes NO daylight saving — America/Phoenix is a fixed UTC-7.
const PHOENIX_TZ = "America/Phoenix";

const UNMAPPED = "Unmapped";

let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; }, "phoenix-ckan");

interface PhxRow {
  _id?: number;
  "INC NUMBER"?: string;
  "OCCURRED ON"?: string;
  "UCR CRIME CATEGORY"?: string;
  ZIP?: string | null;
  "100 BLOCK ADDR"?: string | null;
  "PREMISE TYPE"?: string | null;
  GRID?: string | null;
}

// UCR CRIME CATEGORY → NIBRS three-way bucket. Phoenix's UCR labels are a
// small fixed vocabulary (verified by GROUP BY against the live feed):
//   LARCENY-THEFT, BURGLARY, MOTOR VEHICLE THEFT, AGGRAVATED ASSAULT,
//   DRUG OFFENSE/DRUG OFFENSES, ROBBERY, RAPE, ARSON, SIMPLE ASSAULT,
//   MURDER AND NON-NEGLIGENT MANSLAUGHTER.
// ROBBERY is FBI UCR Part-1 VIOLENT (force against a person) → PERSONS,
// checked before the property keywords so it is never swept into PROPERTY
// (the same robbery-reclassification fix applied to KC / Dallas / Pittsburgh).
function classify(category: string): CrimeCategory {
  const c = category.toUpperCase();
  if (/(ASSAULT|MURDER|MANSLAUGHTER|HOMICIDE|RAPE|SEX|ROBBERY|KIDNAP)/.test(c)) {
    return CrimeCategory.PERSONS;
  }
  if (/(LARCENY|THEFT|BURGLAR|MOTOR VEHICLE|ARSON|STOLEN|VANDAL|DAMAGE|FRAUD)/.test(c)) {
    return CrimeCategory.PROPERTY;
  }
  // DRUG OFFENSE(S) and anything else fall to SOCIETY.
  return CrimeCategory.SOCIETY;
}

// `OCCURRED ON` comes in two shapes (verified by sampling the live feed):
//   * "MM/DD/YYYY  HH:MM"            24-hour, no seconds (the majority)
//   * "M/D/YYYY   H:MM:SSAM/PM"      12-hour with AM/PM + seconds (minority)
// Spacing between the date and time varies (single or multiple spaces).
// We normalize to a canonical "YYYY-MM-DDTHH:MM:SS" wall-clock string, then
// route it through cityLocalToUtcIso(…, America/Phoenix) so the UTC instant
// is correct (Phoenix is a fixed UTC-7, no DST). Returns null when unparseable.
function parsePhoenixDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i,
  );
  if (!m) return null;
  const [, mm, dd, yyyy, hhRaw, mi, ss, ap] = m;
  let hour = Number(hhRaw);
  if (ap) {
    const isPm = ap.toUpperCase() === "PM";
    if (hour === 12) hour = isPm ? 12 : 0;
    else if (isPm) hour += 12;
  }
  const p2 = (n: number | string) => String(n).padStart(2, "0");
  const wallClock =
    `${yyyy}-${p2(mm)}-${p2(dd)}T${p2(hour)}:${mi}:${ss ?? "00"}`;
  const iso = cityLocalToUtcIso(wallClock, PHOENIX_TZ);
  return +new Date(iso) <= 0 ? null : iso;
}

// ZIP → City of Phoenix Urban Village. Built by overlaying the ZCTA polygons
// in apps/web/public/geo against the official Phoenix "Villages" GIS layer and
// assigning each ZIP to the village containing its ZCTA centroid; 85310 and
// 85086 are boundary ZIPs whose area is majority-Phoenix (Deer Valley / North
// Gateway). ZIPs absent here are either suburban (not in any Phoenix village)
// or in a small absorbed village (Encanto, Laveen) and keep their bare ZIP.
const ZIP_TO_VILLAGE: Record<string, string> = {
  "85003": "Central City",      "85004": "Central City",
  "85006": "Central City",      "85007": "Central City",
  "85034": "Central City",
  "85008": "Camelback East",    "85014": "Camelback East",
  "85016": "Camelback East",    "85018": "Camelback East",
  "85012": "Alhambra",          "85013": "Alhambra",
  "85015": "Alhambra",          "85017": "Alhambra",
  "85019": "Alhambra",
  "85020": "North Mountain",    "85021": "North Mountain",
  "85022": "North Mountain",    "85029": "North Mountain",
  "85051": "North Mountain",
  "85023": "Deer Valley",       "85027": "Deer Valley",
  "85053": "Deer Valley",       "85310": "Deer Valley",
  "85024": "Paradise Valley",   "85028": "Paradise Valley",
  "85032": "Paradise Valley",   "85254": "Paradise Valley",
  "85031": "Maryvale",          "85033": "Maryvale",
  "85035": "Maryvale",          "85037": "Maryvale",
  "85009": "Estrella",          "85043": "Estrella",
  "85353": "Estrella",
  "85040": "South Mountain",    "85041": "South Mountain",
  "85042": "South Mountain",
  "85044": "Ahwatukee Foothills", "85045": "Ahwatukee Foothills",
  "85048": "Ahwatukee Foothills",
  "85050": "Desert View",       "85054": "Desert View",
  "85085": "Desert View",
  "85083": "North Gateway",     "85086": "North Gateway",
  "85087": "Rio Vista",
};

// Village → centroid (area-weighted center of the official village polygon),
// used to seed the area picker's "nearest" lookup. Phoenix carries no
// per-incident coordinates, so this is purely for the picker, not the map
// (the map draws the boundary from phoenix.geojson keyed on village name).
const VILLAGE_CENTROID: Record<string, { lat: number; lng: number }> = {
  "Central City": { lat: 33.4418, lng: -112.0496 },
  "Camelback East": { lat: 33.5017, lng: -112.0035 },
  "Alhambra": { lat: 33.5245, lng: -112.1093 },
  "North Mountain": { lat: 33.5909, lng: -112.0989 },
  "Deer Valley": { lat: 33.6845, lng: -112.1208 },
  "Paradise Valley": { lat: 33.618, lng: -111.9963 },
  "Maryvale": { lat: 33.489, lng: -112.2151 },
  "Estrella": { lat: 33.4259, lng: -112.1975 },
  "South Mountain": { lat: 33.3815, lng: -112.0536 },
  "Ahwatukee Foothills": { lat: 33.3209, lng: -112.039 },
  "Desert View": { lat: 33.7295, lng: -112.0015 },
  "North Gateway": { lat: 33.7835, lng: -112.1498 },
  "Rio Vista": { lat: 33.8886, lng: -112.1879 },
};

const PHOENIX_CENTROID = { lat: 33.4484, lng: -112.0740 };

// slug fragment for a village label: lowercased, non-alnum → single hyphen.
// "Camelback East" → "camelback-east", "Ahwatukee Foothills" → "ahwatukee-foothills".
function villageSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ZIP → area label. A Phoenix ZIP that maps to an urban village becomes that
// village name; a real 85xxx ZIP with no village mapping (suburban / absorbed
// village) keeps its bare ZIP string; NULL / blank / literal "NULL" / any
// non-85xxx ZIP (e.g. the stray 86504 on the Navajo Nation) folds into the
// single "Unmapped" bucket.
function areaForZip(zip: string | null | undefined): string {
  const z = (zip ?? "").trim();
  const village = ZIP_TO_VILLAGE[z];
  if (village) return village;
  // v105 — ZIPs with no Phoenix urban-village mapping are suburban/fringe
  // (Mesa 852xx, Tempe 85281, etc.) or small absorbed villages. A bare ZIP
  // like "85201" reads as an unrecognizable "neighborhood", so fold them into
  // the honest "Unmapped" bucket — only the 13 real villages surface as areas.
  return UNMAPPED;
}

// Resolve an area label back to its centroid + slug. Village labels use the
// village slug ("phx-maryvale") and the village centroid; bare-ZIP labels keep
// the "phx-<zip>" slug and the city centroid (we have no ZCTA centroid here).
function slugForArea(label: string): string {
  if (VILLAGE_CENTROID[label]) return `phx-${villageSlug(label)}`;
  return `phx-${label}`;
}
function centroidForArea(label: string): { lat: number; lng: number } {
  return VILLAGE_CENTROID[label] ?? PHOENIX_CENTROID;
}

// Reverse lookup so an incoming slug resolves to a stored area label. Built
// once from ZIP_TO_VILLAGE so "phx-camelback-east" → "Camelback East".
const SLUG_TO_VILLAGE: Record<string, string> = Object.fromEntries(
  Array.from(new Set(Object.values(ZIP_TO_VILLAGE))).map((v) => [villageSlug(v), v]),
);

const PROVENANCE: DataProvenance = {
  source: "Phoenix PD Crime Data · phoenixopendata.com (CKAN)",
  datasetUrl:
    "https://www.phoenixopendata.com/dataset/crime-data",
  // Surfaced verbatim in the UI — this is the honesty signal. The feed is a
  // rolling dataset with a multi-week publication lag (NOT a frozen snapshot),
  // and is ZIP-level only.
  recency:
    "ZIP-level only. Rolling dataset refreshed periodically with a multi-week publication lag, so the newest incidents trail real time; we show the most recent ~18 months available.",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Phoenix Police Department and published on a " +
    "rolling basis with a multi-week publication lag — this is NOT live, NOT " +
    "street-level data. The feed has no coordinates or neighborhoods, only ZIP " +
    "codes, which we map to the City of Phoenix urban villages (Maryvale, " +
    "Camelback East, Central City, …); suburban ZIPs with no Phoenix village " +
    "keep their ZIP label and the ~13% of records with a missing or out-of-area " +
    "ZIP are grouped as \"Unmapped\". CommunitySafe does not track individuals.",
};

interface DatastoreResp {
  success?: boolean;
  result?: { records?: PhxRow[]; total?: number };
}

async function fetchPage(offset: number): Promise<PhxRow[]> {
  const url =
    `${DATASTORE_API}?resource_id=${RESOURCE_ID}` +
    `&limit=${PAGE_SIZE}&offset=${offset}` +
    `&sort=${encodeURIComponent("_id desc")}`;
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Phoenix CKAN ${res.status} offset=${offset}`);
  const body = (await readJson(res)) as DatastoreResp;
  if (body.success === false) throw new Error(`Phoenix CKAN unsuccessful offset=${offset}`);
  return body.result?.records ?? [];
}

async function fetchPhoenix(): Promise<Incident[]> {
  const pages = await Promise.all(
    Array.from({ length: PAGES }, (_, i) =>
      fetchPage(i * PAGE_SIZE).catch((err) => {
        console.warn(`[phx] page offset=${i * PAGE_SIZE} failed: ${(err as Error).message}`);
        return [] as PhxRow[];
      }),
    ),
  );
  const records = pages.flat();
  const out: Incident[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const occurredAt = parsePhoenixDate(r["OCCURRED ON"]);
    if (!occurredAt) continue;
    // Keep only incidents within the rolling window (auto-tracks the feed).
    if (+new Date(occurredAt) < Date.now() - WINDOW_MS) continue;
    const category = (r["UCR CRIME CATEGORY"] ?? "").trim();
    if (!category) continue;
    out.push({
      id: `phx-${r["INC NUMBER"] ?? r._id ?? i}`,
      area: areaForZip(r.ZIP),
      occurredAt,
      nibrsCategory: classify(category),
      ibrOffenseDescription: category,
      beat: null,
      blockLabel: r["100 BLOCK ADDR"] ?? undefined,
    });
  }
  return out;
}

let inFlight: Promise<Incident[]> | null = null;

export async function getRowsPhoenix(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const rows = await fetchPhoenix();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[phx] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// Discovered areas are urban villages (and any unmapped Phoenix ZIPs that
// carry incidents). Village areas get the village slug + village-polygon
// centroid; bare-ZIP areas get "phx-<zip>" + the city centroid (we have no
// ZCTA centroid here). The Crime Map renders the village boundary from
// phoenix.geojson keyed on the village name, so the centroid only seeds the
// area picker's "nearest" lookup.
export async function getDiscoveredAreasPhoenix(): Promise<KnownArea[]> {
  const rows = await getRowsPhoenix();
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.area || r.area === UNMAPPED) continue;
    counts.set(r.area, (counts.get(r.area) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => ({
      slug: slugForArea(label),
      label,
      jurisdiction: "Phoenix",
      centroid: centroidForArea(label),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// Resolve a Phoenix area slug back to the stored area label. Accepts a village
// slug ("phx-maryvale" / "maryvale" → "Maryvale"), a ZIP slug ("phx-85021" →
// "85021"), or a bare ZIP ("85021"). Returns null for anything unrecognized.
function labelForPhxSlug(slug: string): string | null {
  const want = slug.toLowerCase().startsWith("phx-") ? slug.slice(4) : slug.toLowerCase();
  if (SLUG_TO_VILLAGE[want]) return SLUG_TO_VILLAGE[want];
  return /^85\d{3}$/.test(want) ? want : null;
}

export const phoenixAdapter: CrimeDataAdapter = {
  name: "phoenix-ckan",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsPhoenix();
    const label = labelForPhxSlug(area);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    // Self-calibrating quintile bands over Phoenix's own per-area
    // distribution (now village-level); degrades to these static thresholds
    // for a thin set. Village buckets are larger than single ZIPs, so the
    // static fallbacks are scaled up accordingly.
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [400, 1200, 2500, 4500]);
    return {
      area: label,
      crimeRate: null,
      violentCrimeRate: null,
      propertyCrimeRate: null,
      riskLevel,
      provenance: PROVENANCE,
    };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsPhoenix();
    const label = labelForPhxSlug(area);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered = [...filtered].sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },

  async getRecentReports(area: string, opts?: { limit?: number }) {
    return this.getIncidents(area, { limit: opts?.limit ?? 20 });
  },
};
