import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT, fetchWithRetry } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";
import { GENERATED_AREA_CENTROIDS } from "../area-centroids-generated.js";
import { VB_AREA_CENTROIDS } from "../data/virginia-beach-area-centroids.js";

// Virginia Beach — VBPD "Police Offense Reports" (FeatureServer, keyless).
// Hosted ArcGIS Online layer (org CyVvlIiUfRBmMQuu) carrying ~163k
// incident-level rows back to 2021. geometryType is None (NO lat/lng on
// any row) — coordinates simply aren't published — so we bucket by the
// pre-joined `Subdivision` field (a named VB platted-subdivision /
// civic-league area like "ROSEMONT FOREST SOUTH") rather than PIP.
// Verified fresh through ~2026-05-29 with a rolling 12-month window.
// Doc: https://data-vbgov.opendata.arcgis.com (Police Offense Reports)
//
// AREA bucketing mirrors Tucson: title-case the Subdivision name; fold
// purely-numeric / blank / obvious beat-code values (e.g. "019A", "120",
// "") into a single honest "Unmapped" bucket. VB has very high subdivision
// cardinality (~960 named areas in a 12-month window), so only the subset
// that matches a Planning-Subdivisions polygon renders on the Crime Map —
// the rest still aggregate correctly, they just have no boundary shape.
const BASE = "https://services2.arcgis.com/CyVvlIiUfRBmMQuu/arcgis/rest/services/Police_Incident_Reports_view/FeatureServer/0/query";
const PAGE_SIZE = 2000;
// Rolling ~12-month window holds ~30k rows; 20 pages × 2k = 40k caps it
// with headroom so we never silently truncate the busiest neighborhoods.
const PAGES = 20;
// 365-day rolling window, filtered server-side on Date_Occurred (epoch ms).
const WINDOW_DAYS = 365;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; }, "virginia-beach-arcgis");

interface VbRow {
  IncidentNumber?: number;
  Date_Occurred?: number | null;
  Offense_Code?: string;
  Offense_Description?: string;
  Subdivision?: string | null;
  Precinct?: string | null;
  Zone_ID?: string | null;
  OBJECTID?: number;
}

function classify(row: VbRow): CrimeCategory {
  const desc = `${row.Offense_Description ?? ""}`.toUpperCase();
  if (/(ASSAULT|ROBBERY|HOMICIDE|MURDER|RAPE|SEX|FONDLING|SODOMY|KIDNAP|ABDUCT|STALK|THREAT|INTIMIDAT|STRANGUL|HUMAN TRAFFIC|EXTORTION)/.test(desc)) return CrimeCategory.PERSONS;
  if (/(BURGLAR|B ?& ?E|THEFT|LARCEN|STOLEN|VANDAL|DESTRUCTION|ARSON|FRAUD|FORGERY|COUNTERFEIT|EMBEZZ|MOTOR VEHICLE|SHOPLIFT)/.test(desc)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// Title-case a raw Subdivision name. The Crime Map's geojson uses the same
// title-cased label as `properties.name`, so this MUST match the casing of
// apps/web/public/geo/virginia-beach.geojson for the polygons to bind.
function titleCaseArea(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Fold purely-numeric ("019A", "120"), blank, and obvious beat-codes into
// a single "Unmapped" bucket — the exact Tucson filter, widened only to
// catch VB's trailing-letter beat codes (e.g. "044B", "165H").
function isUnmappedSubdivision(v: string | null | undefined): boolean {
  if (!v || !v.trim()) return true;
  return /^\d+[A-Za-z]?$/.test(v.trim());
}

const VB_CENTROID = { lat: 36.8529, lng: -76.0339 };
// fix(audit cities-vb-centroid-collapse): VB's feed has no per-incident coords,
// and its free-text Subdivision names only slug-match ~33% of the city's
// Planning_Subdivisions polygon layer — so 629 of 961 areas collapsed onto
// VB_CENTROID and "use my location" / map markers could never distinguish them.
// VB_AREA_CENTROIDS resolves 962 subdivisions to real points (Census-geocoded
// representative incident addresses + matching polygon centroids; see
// tools/build-virginia-beach-centroids.mjs). GENERATED_AREA_CENTROIDS (the
// 333-polygon geojson) stays as a secondary fallback; only un-geocodable
// subdivisions with no polygon fall through to the citywide point.
const VB_CENTROIDS = GENERATED_AREA_CENTROIDS["virginia-beach"] ?? {};

const PROVENANCE: DataProvenance = {
  source: "Virginia Beach Police Department Offense Reports (City of Virginia Beach, ArcGIS Feature Server)",
  datasetUrl: "https://data-vbgov.opendata.arcgis.com",
  recency: "Rolling 12-month window, refreshed by Virginia Beach PD",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Virginia Beach Police Department and grouped by Subdivision. " +
    "Not live, not street-level. CommunitySafe does not track individuals.",
};

async function fetchPage(offset: number, sinceDate: string): Promise<VbRow[]> {
  const url = new URL(BASE);
  // Date_Occurred is an esri date field — a bare epoch-ms comparison is
  // rejected ("Invalid query parameters"); it needs a DATE 'YYYY-MM-DD'
  // literal (verified against the live FeatureServer).
  url.searchParams.set("where", `Date_Occurred > DATE '${sinceDate}'`);
  url.searchParams.set(
    "outFields",
    "IncidentNumber,Date_Occurred,Offense_Code,Offense_Description,Subdivision,Precinct,Zone_ID,OBJECTID",
  );
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "Date_Occurred DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  // fix(deploy logs): retry undici-level transient "fetch failed" drops.
  const res = await fetchWithRetry(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  if (!res.ok) {
    // High offsets page past the end of the window — ArcGIS answers
    // 404/400 there. On a non-first page that's just end-of-data, not a
    // failure, so return empty instead of logging a bogus warning.
    if (offset > 0 && (res.status === 404 || res.status === 400)) return [];
    throw new Error(`Virginia Beach ArcGIS ${res.status} offset=${offset}`);
  }
  const body = await res.json() as { features?: Array<{ attributes: VbRow }>; error?: { code?: number; message?: string } };
  if (body.error) throw new Error(`Virginia Beach ArcGIS error ${body.error.code}: ${body.error.message}`);
  return (body.features ?? []).map((f) => f.attributes);
}

async function fetchVirginiaBeach(): Promise<Incident[]> {
  const sinceDate = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const results: VbRow[][] = new Array(PAGES);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= PAGES) return;
      results[i] = await fetchPage(i * PAGE_SIZE, sinceDate).catch((err) => {
        console.warn(`[vb] page offset=${i * PAGE_SIZE} failed: ${(err as Error).message}`);
        return [] as VbRow[];
      });
    }
  });
  await Promise.all(workers);
  const rows = results.flat();
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const ts = r.Date_Occurred;
    if (!ts) continue;
    // The feed publishes Date_Occurred as an absolute epoch-ms instant
    // (full time-of-day), so new Date(ms) is already correct UTC — no
    // wall-clock-to-UTC conversion is needed (cf. Tucson/Raleigh).
    const area = isUnmappedSubdivision(r.Subdivision) ? "Unmapped" : titleCaseArea(r.Subdivision as string);
    out.push({
      id: `vb-${r.IncidentNumber ?? r.OBJECTID ?? i}`,
      area,
      occurredAt: new Date(ts).toISOString(),
      nibrsCategory: classify(r),
      ibrOffenseDescription: titleCaseOffense(r.Offense_Description ?? "Unknown"),
      beat: r.Zone_ID ?? r.Precinct ?? null,
      blockLabel: undefined,
      lat: undefined,
      lng: undefined,
    });
  }
  return out;
}

// v107 — in-flight fetch dedup (the OOM-guard Detroit added in v94): the
// dispatcher fans a per-area Promise.all over every neighbourhood, so a cold
// cache previously fired N concurrent full fetches. Concurrent callers now
// await the same promise.
let inFlightVirginiaBeachFetch: Promise<Incident[]> | null = null;
export async function getRowsVirginiaBeach(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightVirginiaBeachFetch) return inFlightVirginiaBeachFetch;
  inFlightVirginiaBeachFetch = (async () => {
    try {
      const rows = await fetchVirginiaBeach();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[vb] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightVirginiaBeachFetch = null;
    }
  })();
  return inFlightVirginiaBeachFetch;
}

// Aggregate VB rows into [{area, count}], sorted by incident count DESC. Shared
// by the full-aggregation discover() and the display-only primary list so the two
// can never diverge in how they identify/slug a subdivision.
async function aggregateVirginiaBeachAreas(): Promise<Array<{ area: KnownArea; count: number }>> {
  const rows = await getRowsVirginiaBeach();
  const agg = new Map<string, number>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown" || r.area === "Unmapped") continue;
    // Drop purely-numeric labels (mirrors the Tucson/Cincinnati filter) —
    // belt-and-suspenders, since isUnmappedSubdivision already folds them.
    if (/^\d+$/.test(r.area.trim())) continue;
    agg.set(r.area, (agg.get(r.area) ?? 0) + 1);
  }
  return Array.from(agg.entries())
    .map(([name, count]) => {
      const slug = `vb-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
      return {
        area: {
          slug,
          label: name,
          jurisdiction: "Virginia Beach",
          // VB rows carry no coordinates (geometryType None), so per-area centroids
          // fall back to geocoded/citywide centroids.
          centroid: VB_AREA_CENTROIDS[slug] ?? VB_CENTROIDS[slug] ?? { ...VB_CENTROID },
        } as KnownArea,
        count,
      };
    })
    .sort((a, b) => b.count - a.count);
}

// FULL discovery — every subdivision with >=1 incident. This list drives the
// CITYWIDE aggregation (safety-score / dispatcher sum incidents per discovered
// area), so it MUST stay complete: dropping an area would drop its incidents from
// the citywide grade and undercount the city. Do NOT threshold this.
export async function getDiscoveredAreasVirginiaBeach(): Promise<KnownArea[]> {
  const agg = await aggregateVirginiaBeachAreas();
  return agg.map((e) => e.area).sort((a, b) => a.label.localeCompare(b.label));
}

// fix(audit vb-over-fragmentation): VB's ArcGIS feed splits the city into ~961
// Planning Subdivisions, most with a single incident — so the raw discover() list
// inflated the user-facing "neighborhoods tracked" count and picker to 961 (22% of
// the whole fleet). This DISPLAY-ONLY list keeps the busiest subdivisions — those
// with enough incidents to produce a non-noise neighborhood score — so the count
// and picker reflect ~real civic areas. The full discover() above still feeds the
// citywide sum, so NO incident is lost from the grade. A subdivision hidden here is
// still aggregated citywide and still resolves if deep-linked; it just isn't
// individually offered in the picker.
const VB_PRIMARY_MIN_INCIDENTS = 12;
const VB_PRIMARY_MAX_AREAS = 100;
export async function getPrimaryAreasVirginiaBeach(): Promise<KnownArea[]> {
  const agg = await aggregateVirginiaBeachAreas();
  const primary = agg.filter((e) => e.count >= VB_PRIMARY_MIN_INCIDENTS).slice(0, VB_PRIMARY_MAX_AREAS);
  // Safety: if a sparse pull leaves too few above-threshold areas, fall back to the
  // busiest ones so the city never shows an empty picker.
  const chosen = primary.length >= 10 ? primary : agg.slice(0, Math.min(VB_PRIMARY_MAX_AREAS, agg.length));
  return chosen.map((e) => e.area).sort((a, b) => a.label.localeCompare(b.label));
}

function labelForVbSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("vb-") ? s.slice(3) : s;
  for (const r of rows) {
    const cand = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (cand === want) return r.area;
  }
  return null;
}

export const virginiaBeachAdapter: CrimeDataAdapter = {
  name: "virginia-beach-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsVirginiaBeach();
    const label = labelForVbSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [25, 75, 150, 300]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },
  async getIncidents(area, opts) {
    const rows = await getRowsVirginiaBeach();
    const label = labelForVbSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },
  async getRecentReports(area, opts) { return this.getIncidents(area, { limit: opts?.limit ?? 20 }); },
};
