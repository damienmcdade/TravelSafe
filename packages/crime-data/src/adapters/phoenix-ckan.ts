import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT } from "../lib/http.js";

// Phoenix AZ — Phoenix PD Crime Data (phoenixopendata.com CKAN datastore).
//
// HONESTY NOTE — read before touching this adapter:
// Phoenix was REMOVED from the app once before for under-counting, and the
// upstream data is genuinely compromised. The ONLY official feed is an
// ANNUAL ARCHIVAL SNAPSHOT, not a live feed:
//   * It is FROZEN at 2025-12-31 — the newest row in the dataset occurred
//     on 2025-12-31. There is no rolling refresh; it updates roughly once a
//     year. So our "recency" is honestly "data through Dec 2025".
//   * Geography is ZIP-ONLY. There is no lat/lng, no neighborhood, no beat.
//     We bucket by the `ZIP` column → area label = the bare ZIP string
//     (e.g. "85021"), which the apps/web/public/geo/phoenix.geojson ZCTA
//     polygons match on `properties.name`.
//   * ~13% of 2025 rows carry a NULL / blank / literal-"NULL" / non-Phoenix
//     ZIP. Those are folded into a single honest "Unmapped" bucket rather
//     than dropped (so citywide totals stay complete) or faked.
// Every one of these limits is surfaced verbatim in PROVENANCE below and is
// the reason the city-meta/use-city wiring must show a "data through Dec
// 2025" banner. Do NOT present this as live/street-level data.
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

// Only keep incidents occurring in this calendar year and later. The
// snapshot ends 2025-12-31, so this yields the most recent ~12 months
// present in the data (an honest full-year window, not a rolling one).
const WINDOW_START_MS = Date.UTC(2025, 0, 1);

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

// ZIP → area label. A real Phoenix-metro 85xxx ZIP becomes its own bucket
// (the bare ZIP string, matching the ZCTA geojson's properties.name); NULL,
// blank, the literal string "NULL", and any non-85xxx ZIP (e.g. the stray
// 86504 on the Navajo Nation) fold into the single "Unmapped" bucket.
function areaForZip(zip: string | null | undefined): string {
  const z = (zip ?? "").trim();
  if (/^85\d{3}$/.test(z)) return z;
  return UNMAPPED;
}

const PHOENIX_CENTROID = { lat: 33.4484, lng: -112.0740 };

const PROVENANCE: DataProvenance = {
  source: "Phoenix PD Crime Data · phoenixopendata.com (CKAN, annual snapshot)",
  datasetUrl:
    "https://www.phoenixopendata.com/dataset/crime-data",
  // Surfaced verbatim in the UI — this is the honesty signal. The feed is an
  // annual archival snapshot frozen at 2025-12-31, NOT a live/rolling feed.
  recency:
    "Data through Dec 2025 — annual snapshot (frozen at 2025-12-31, updated about once a year). ZIP-level only.",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Phoenix Police Department and published as an " +
    "annual archival snapshot that ends Dec 31 2025 — this is NOT live, NOT " +
    "street-level data. The feed has no coordinates or neighborhoods, so " +
    "incidents are bucketed by ZIP code; the ~13% of records with a missing or " +
    "out-of-area ZIP are grouped as \"Unmapped\". CommunitySafe does not track individuals.",
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
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Phoenix CKAN ${res.status} offset=${offset}`);
  const body = (await res.json()) as DatastoreResp;
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
    // Keep only the most-recent full year present in the snapshot (2025).
    if (+new Date(occurredAt) < WINDOW_START_MS) continue;
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

// Phoenix has no per-incident coordinates, so the centroid for every ZIP
// area is the ZCTA polygon center we don't carry here — we report the city
// centroid for each discovered area. The Crime Map renders the actual
// boundary from phoenix.geojson keyed on the ZIP label, so the discovered
// centroid only seeds the area picker's "nearest" lookup.
export async function getDiscoveredAreasPhoenix(): Promise<KnownArea[]> {
  const rows = await getRowsPhoenix();
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.area || r.area === UNMAPPED) continue;
    counts.set(r.area, (counts.get(r.area) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([zip]) => ({
      slug: `phx-${zip}`,
      label: zip,
      jurisdiction: "Phoenix",
      centroid: PHOENIX_CENTROID,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// Resolve a Phoenix area slug ("phx-85021") or a bare ZIP ("85021") back to
// the stored area label (the bare ZIP string).
function labelForPhxSlug(slug: string): string | null {
  const want = slug.toLowerCase().startsWith("phx-") ? slug.slice(4) : slug;
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
    // Self-calibrating quintile bands over Phoenix's own per-ZIP
    // distribution; degrades to these static thresholds for a thin set.
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [150, 400, 800, 1500]);
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
