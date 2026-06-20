import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { USER_AGENT, readJson, fetchWithRetry } from "../lib/http.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";

// Henderson, NV — Henderson Police Department public ArcGIS MapServers.
// Incident-level rows with point geometry already in WGS84, a single clean
// offense (`INC_PRIMAR`), the HPD patrol BEAT (e.g. "E4", "N6", "W3"), an
// event number (`EVENT__`, the dedup key), and a real start datetime
// (`OCCURRED_S`, epoch-ms with hour-level time — no separate hour field
// needed). We group by HPD beat (no point-in-polygon required).
//
// Two layers are UNIONed to cover the score's ~400-day window:
//   • crimes/0 "Current Crimes"  — continuous rolling YTD-2026 feed
//     (~1,100 rows, ~2026-03-22 → yesterday). This is the ONLY layer with
//     2026 coordinate-bearing incidents — the OpenDataPublicSafety "Daily
//     Crime Data" layer is a ~2-day window (≈23 rows) and is too thin.
//   • OpenDataPublicSafety/17 "Crime Data 2025" — the most recent annual
//     archive (~27k rows, ends 2025-12-31), same schema, fills the year
//     behind the rolling feed.
// Rows are deduped by EVENT__ so the seam between the two layers is clean.
// Sources:
//   https://maps.cityofhenderson.com/arcgis/rest/services/public/crimes/MapServer/0
//   https://maps.cityofhenderson.com/arcgis/rest/services/public/OpenDataPublicSafety/MapServer/17

const CURRENT_BASE =
  "https://maps.cityofhenderson.com/arcgis/rest/services/public/crimes/MapServer/0/query";
const ANNUAL_BASE =
  "https://maps.cityofhenderson.com/arcgis/rest/services/public/OpenDataPublicSafety/MapServer/17/query";
const PAGE_SIZE = 1000; // = server maxRecordCount
const WINDOW_DAYS = 400; // a touch over a year so the 365d score window is fully covered
// Per-layer page caps. Current Crimes is small (~1.1k rows total, single page
// usually suffices); the 2025 annual is large (~27k) but only its tail falls
// inside the window — 16 pages (16k) covers the last ~13 months comfortably.
const CURRENT_PAGES = 4;
const ANNUAL_PAGES = 16;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;
registerRowCache(() => {
  cache = null;
}, "henderson-arcgis");

interface HendersonFeature {
  attributes: {
    OBJECTID?: number;
    EVENT__?: string; // HPD event number — stable incident id / dedup key
    INC_PRIMAR?: string; // single offense, e.g. "ASSAULT/BATTERY", "ROBBERY"
    BEAT?: string; // HPD patrol beat, e.g. "E4", "N6", "W3"
    OCCURRED_S?: number; // epoch ms, incident start (carries real hour-of-day)
    INC_ADDRESS?: string; // block-level address, e.g. "1300 BLOCK W SUNSET RD"
  };
  geometry?: { x: number; y: number }; // x=lng, y=lat (WGS84 when outSR=4326)
}

// Henderson INC_PRIMAR → CommunitySafe bucket. Crimes Against Persons /
// Property / Society. Robbery is filed by the FBI UCR as a Part-1 VIOLENT
// offense, so it maps to PERSONS (same convention as the Long Beach / Dallas /
// Saint Paul / Dayton adapters). Each row carries exactly one offense.
function classify(primary: string | undefined): CrimeCategory {
  const s = (primary ?? "").toUpperCase();
  if (s.includes("ROBBERY")) return CrimeCategory.PERSONS;
  if (
    s.includes("ASSAULT") ||
    s.includes("BATTERY") ||
    s.includes("HOMICIDE") ||
    s.includes("MURDER") ||
    s.includes("MANSLAUGHTER") ||
    s.includes("KIDNAP") ||
    s.includes("ABDUCTION") ||
    s.includes("SEX")
  ) {
    return CrimeCategory.PERSONS;
  }
  if (
    s.includes("BURGLARY") ||
    s.includes("LARCENY") ||
    s.includes("THEFT") ||
    s.includes("MOTOR VEHICLE") ||
    s.includes("ARSON") ||
    s.includes("VANDALISM") ||
    s.includes("DESTRUCTION") ||
    s.includes("FRAUD") ||
    s.includes("FORGERY") ||
    s.includes("STOLEN PROPERTY")
  ) {
    return CrimeCategory.PROPERTY;
  }
  return CrimeCategory.SOCIETY;
}

// HPD beats are coded "<DIV><n>" where DIV ∈ {E,N,W} (East/North/West patrol
// divisions) and n is the beat number, e.g. "E4". Label them readably while
// keeping the code so the area round-trips through the slug.
function labelForBeat(beat: string): string {
  const b = beat.trim().toUpperCase();
  return `HPD Beat ${b}`;
}

function slugifyBeat(beat: string): string {
  return `hnd-${beat.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

const PROVENANCE: DataProvenance = {
  source: "Henderson Police Department (City of Henderson ArcGIS Open Data)",
  datasetUrl:
    "https://maps.cityofhenderson.com/arcgis/rest/services/public/crimes/MapServer",
  recency:
    "Rolling incident feed refreshed by the Henderson Police Department (current-year incidents plus the most recent annual archive)",
  granularity: "beat",
  disclaimer:
    "Incidents are reported by the Henderson Police Department and grouped by HPD patrol beat — " +
    "not live, not street-level. CommunitySafe does not track individuals.",
};

function occurredAtFor(ms: number | undefined): string {
  // OCCURRED_S is epoch-ms and carries the real hour-of-day, so the instant is
  // already unambiguous — emit it as UTC ISO directly (no local-wall-clock
  // reconstruction needed).
  if (typeof ms !== "number" || !Number.isFinite(ms)) return new Date().toISOString();
  return new Date(ms).toISOString();
}

async function fetchPage(
  base: string,
  offset: number,
  sinceTs: string,
): Promise<HendersonFeature[]> {
  const url = new URL(base);
  // ArcGIS date fields require a timestamp literal, not a raw epoch number.
  url.searchParams.set("where", `OCCURRED_S >= timestamp '${sinceTs}'`);
  url.searchParams.set("outFields", "OBJECTID,EVENT__,INC_PRIMAR,BEAT,OCCURRED_S,INC_ADDRESS");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("orderByFields", "OCCURRED_S DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("cacheHint", "true");
  url.searchParams.set("f", "json");
  const res = await fetchWithRetry(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Henderson ArcGIS ${res.status} offset=${offset}`);
  const body = (await readJson(res)) as { features?: HendersonFeature[]; error?: unknown };
  // Throw on the embedded ArcGIS error envelope (HTTP 200 + {error:{...}}) so a
  // token-gated/failed layer serves last-known-good instead of grading as zero-crime.
  if (body.error) throw new Error(`Henderson ArcGIS body error offset=${offset}`);
  return body.features ?? [];
}

async function fetchLayer(base: string, pages: number, sinceTs: string): Promise<HendersonFeature[]> {
  const results: HendersonFeature[][] = new Array(pages);
  let cursor = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= pages) return;
      results[i] = await fetchPage(base, i * PAGE_SIZE, sinceTs).catch(
        () => [] as HendersonFeature[],
      );
    }
  });
  await Promise.all(workers);
  return results.flat();
}

async function fetchHenderson(): Promise<Incident[]> {
  const sinceTs = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  const [current, annual] = await Promise.all([
    fetchLayer(CURRENT_BASE, CURRENT_PAGES, sinceTs),
    fetchLayer(ANNUAL_BASE, ANNUAL_PAGES, sinceTs),
  ]);
  // Union both layers, deduping by EVENT__ (the rolling feed wins on overlap).
  const byEvent = new Map<string, HendersonFeature>();
  for (const f of [...current, ...annual]) {
    const key = (f.attributes.EVENT__ ?? `oid-${f.attributes.OBJECTID}`).trim();
    if (!byEvent.has(key)) byEvent.set(key, f);
  }
  return Array.from(byEvent.values())
    .filter(
      (f) =>
        typeof f.attributes.OCCURRED_S === "number" &&
        (f.attributes.BEAT ?? "").trim() &&
        f.geometry != null &&
        f.geometry.x !== 0 &&
        f.geometry.y !== 0,
    )
    .map((f, i) => {
      const a = f.attributes;
      const beat = (a.BEAT ?? "").trim().toUpperCase();
      return {
        id: `hnd-${(a.EVENT__ ?? "").trim() || a.OBJECTID || i}`,
        area: labelForBeat(beat),
        occurredAt: occurredAtFor(a.OCCURRED_S),
        nibrsCategory: classify(a.INC_PRIMAR),
        ibrOffenseDescription: titleCaseOffense(a.INC_PRIMAR ?? "Unknown"),
        beat,
        blockLabel: a.INC_ADDRESS?.trim() || undefined,
        lat: f.geometry!.y,
        lng: f.geometry!.x,
      } as Incident;
    });
}

// In-flight fetch dedup: the dispatcher fans a per-area Promise.all over every
// beat, so a cold cache would otherwise fire N concurrent full fetches.
let inFlightFetch: Promise<Incident[]> | null = null;
export async function getRowsHenderson(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightFetch) return inFlightFetch;
  inFlightFetch = (async () => {
    try {
      const rows = await fetchHenderson();
      if (rows.length > 0) cache = { fetchedAt: now, rows };
      return rows;
    } catch (err) {
      console.warn("[henderson] fetch failed:", (err as Error).message);
      return cache?.rows ?? [];
    } finally {
      inFlightFetch = null;
    }
  })();
  return inFlightFetch;
}

export async function getDiscoveredAreasHenderson(): Promise<KnownArea[]> {
  const rows = await getRowsHenderson();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area) continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat;
    e.lngSum += r.lng;
    e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 3)
    .map(([name, e]) => ({
      slug: slugifyBeat(name.replace(/^HPD Beat /, "")),
      label: name,
      jurisdiction: "Henderson",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForSlug(slug: string, rows: Incident[]): string | null {
  const want = slug.toLowerCase();
  for (const r of rows) {
    if (slugifyBeat((r.beat ?? "").trim()) === want) return r.area;
  }
  return null;
}

export const hendersonAdapter: CrimeDataAdapter = {
  name: "henderson-arcgis",
  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsHenderson();
    const label = labelForSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [40, 120, 250, 500]);
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
    const rows = await getRowsHenderson();
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
