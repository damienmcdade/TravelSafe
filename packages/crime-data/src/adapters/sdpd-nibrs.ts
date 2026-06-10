import { parse as parseCsv } from "csv-parse/sync";
import { env } from "../env.js";
import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import type { KnownArea } from "../neighborhoods.js";
import { findArea } from "../neighborhoods.js";

// 5-minute cache: half the client's 10-minute refresh window so a 10-minute
// client refresh always lands on a fresh upstream pull (matched TTLs were
// causing repeated stale-looking responses).
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; year: number; rows: Incident[] } | null = null;
registerRowCache(() => { cache = null; }, "sdpd-nibrs");

// Last-known-good discovered-areas cache. Independent from `cache` (rows)
// so a transient upstream failure that empties the row cache doesn't also
// blank the neighborhood list — the UI keeps showing the previously
// discovered neighborhoods and surfaces a "stale" flag so the page can
// say "live feed warming up" instead of "0 neighborhoods".
let lastDiscovered: { fetchedAt: number; areas: KnownArea[] } | null = null;

function mapCrimeAgainst(value: string | undefined, offenseDesc?: string): CrimeCategory {
  // fix(audit robbery-misclass): robbery is NIBRS "Crime Against Property" (PR)
  // but FBI UCR Part-1 VIOLENT — force it to PERSONS before the passthrough.
  if ((offenseDesc ?? "").toLowerCase().includes("robbery")) return CrimeCategory.PERSONS;
  const v = (value ?? "").trim().toUpperCase();
  if (v === "PE" || v === "PERSON" || v === "PERSONS") return CrimeCategory.PERSONS;
  if (v === "PR" || v === "PROPERTY") return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// Display-label remap. SDPD publishes neighborhood names like
// "Core-Columbia" that residents don't recognize — that beat is what
// people call "Downtown" San Diego. We relabel for display while
// keeping the upstream slug so historical URLs continue to resolve.
//
// The hardcoded `downtown-sd` fallback in neighborhoods.ts was
// removed alongside this remap so the two no longer collide into a
// duplicate "Downtown" row in the neighborhood list.
const AREA_LABEL_REMAP: Record<string, string> = {
  "Core-Columbia": "Downtown",
};
const AREA_LABEL_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(AREA_LABEL_REMAP).map(([upstream, display]) => [display, upstream]),
);
function displayLabel(upstreamName: string): string {
  return AREA_LABEL_REMAP[upstreamName] ?? upstreamName;
}
function upstreamName(label: string): string {
  return AREA_LABEL_REVERSE[label] ?? label;
}

const PROVENANCE: DataProvenance = {
  source: "SDPD NIBRS Crime Offenses (City of San Diego Open Data)",
  datasetUrl: "https://data.sandiego.gov/datasets/police-nibrs/",
  recency: "Quarterly refresh; aggregated to neighborhood/beat",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the San Diego Police Department and aggregated to " +
    "neighborhood/beat — not live, not street-level. CommunitySafe does not track individuals.",
};

async function fetchYear(year: number): Promise<Incident[]> {
  const url = `${env.SDPD_NIBRS_CSV_BASE}/pd_nibrs_${year}_datasd.csv`;
  const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`SDPD NIBRS ${res.status} fetching ${url}`);
  const csv = await res.text();
  const records: Record<string, string>[] = parseCsv(csv, { columns: true, skip_empty_lines: true });
  return records.map((r, i) => {
    const lat = Number(r.latitude);
    const lng = Number(r.longitude);
    return {
      id: `${year}-${r.nibrs_uniq ?? r.objectid ?? i}`,
      area: r.neighborhood?.trim() || r.beat?.trim() || "Unknown",
      occurredAt: parseOccurredAt(r),
      nibrsCategory: mapCrimeAgainst(r.crime_against, r.ibr_offense_description ?? r.ibr_category),
      ibrOffenseDescription: r.ibr_offense_description ?? r.ibr_category ?? "Unknown",
      beat: r.beat ?? null,
      blockLabel: r.block_addr ?? undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lng) && lng !== 0 ? lng : undefined,
    };
  });
}

function parseOccurredAt(r: Record<string, string>): string {
  const raw = r.occured_on ?? r.occurred_on ?? "";
  if (raw) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const y = Number(r.year);
  const m = Number(r.month);
  if (y && m) return new Date(Date.UTC(y, m - 1, 15)).toISOString();
  return new Date(0).toISOString();
}

// v107 — in-flight fetch dedup (the OOM-guard Detroit added in v94). SDPD is in
// the heavy warm bucket; without this the dispatcher's per-area fan-out fired N
// concurrent full CSV fetches on a cold cache. Concurrent callers now await the
// same promise.
let inFlightSdFetch: Promise<Incident[]> | null = null;

export async function getRows(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  if (inFlightSdFetch) return inFlightSdFetch;
  inFlightSdFetch = (async () => {
    try {
      const currentYear = new Date().getFullYear();
      let rows: Incident[] = [];
      for (let y = currentYear; y >= currentYear - 2 && rows.length === 0; y--) {
        try {
          rows = await fetchYear(y);
          cache = { fetchedAt: now, year: y, rows };
          break;
        } catch (err) {
          // Log so upstream feed problems show up in deploy logs instead of
          // silently falling back to the prior year — matches the pattern in
          // every other adapter's fetch path.
          console.warn(`[sdpd] fetchYear(${y}) failed:`, (err as Error).message);
          if (y === currentYear - 2) throw err;
        }
      }
      return rows;
    } finally {
      inFlightSdFetch = null;
    }
  })();
  return inFlightSdFetch;
}

/// Discover neighborhoods from the cached SDPD CSV. Every unique neighborhood
/// name in the data becomes a KnownArea with a centroid computed from the
/// average of its incidents' lat/lng. This replaces the hardcoded list of 7
/// neighborhoods with the full ~100 SDPD recognizes.
///
/// SOFT-FAIL: when the upstream CSV is unreachable (network error, 5xx,
/// rate-limited) or returns an empty body, the freshly-computed list is
/// empty. Instead of propagating that empty result — which earlier caused
/// the "0 supported neighborhoods" UI bug — we return the LAST-KNOWN-GOOD
/// list cached in `lastDiscovered` and let the API layer surface a
/// "stale" marker so the page can say "live feed warming up" rather than
/// silently rendering an empty wheel.
export async function getDiscoveredAreas(): Promise<KnownArea[]> {
  const fresh = await computeDiscovered();
  if (fresh.length > 0) {
    lastDiscovered = { fetchedAt: Date.now(), areas: fresh };
    return fresh;
  }
  // Fresh pull came back empty — fall back to the last-known-good list
  // if we have one. The UI sees a non-zero list and renders normally;
  // staleness is exposed separately via `getDiscoveredAreasStale()`.
  if (lastDiscovered && lastDiscovered.areas.length > 0) {
    return lastDiscovered.areas;
  }
  return [];
}

/// True when the most recent getDiscoveredAreas() call served stale
/// data because the fresh pull came back empty. The /api/geo/areas route
/// includes this flag in its response so the client can render a
/// "live feed warming up" hint instead of "0 neighborhoods".
export function getDiscoveredAreasStale(): boolean {
  if (!lastDiscovered) return false;
  // Stale only matters if the cache is fresher than the row cache —
  // otherwise we have no signal whether we'd have data if upstream
  // were healthy. Approximation: stale when row cache is missing OR
  // the row cache fetchedAt is older than the last-discovered fetchedAt.
  if (!cache) return true;
  return cache.fetchedAt < lastDiscovered.fetchedAt;
}

async function computeDiscovered(): Promise<KnownArea[]> {
  const rows = await getRows().catch(() => [] as Incident[]);
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    const name = r.area?.trim();
    // SDPD's CSV includes pseudo-neighborhood labels like "Unknown",
    // "Unknown - Northeastern", "Unknown - Southern" that are catch-all
    // buckets for incidents the source couldn't geocode. They are not real
    // places and should never appear in the UI's neighborhood list, the
    // autocomplete, or the polygon coverage audit.
    if (!name || /^unknown\b/i.test(name)) continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(name) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat; e.lngSum += r.lng; e.count += 1;
    agg.set(name, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 3) // drop near-empty noise
    .map(([name, e]) => {
      const label = displayLabel(name);
      return {
        // Keep the slug derived from the DISPLAY label so URLs and
        // polygon-area lookups (which use the slug) line up with what
        // the user sees. The reverse map handles incident matching
        // against the upstream name.
        slug: slugify(label),
        label,
        jurisdiction: "San Diego",
        centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// v68 — derive the upstream CSV neighborhood string from a slug. The
// adapter used to rely on findArea() in neighborhoods.ts to map slug
// → label, then upstreamName(label) → upstream CSV name. But
// findArea uses listKnownAreasSync() which returns the FALLBACK_AREAS
// (only 6 entries) until an async listKnownAreas() call populates the
// shared cache. Most SD area slugs ("adams-north", "barrio-logan",
// "balboa-park", etc.) aren't in the fallback, so findArea returned
// null and the matcher fell back to lowercased-slug. CSV neighborhoods
// have spaces ("Adams North" → "adams north") while slugs have dashes
// ("adams-north"); the strict equality never matched, dropping ~80%
// of SD's 28k CSV rows from per-area counts and producing the 0.27×
// PERSONS ratio vs FBI baseline flagged by the grade-sanity worker.
//
// New approach: convert slug → display name by reversing slugify
// (dashes back to spaces, title-case each word), then apply
// upstreamName for the Downtown ↔ Core-Columbia remap.
function slugToCsvNeighborhood(slug: string): string {
  const titleCased = slug
    .split("-")
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
  return upstreamName(titleCased);
}

export const sdpdNibrsAdapter: CrimeDataAdapter = {
  name: "sdpd-nibrs",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRows();
    // v68 — when findArea returns null (the common case for auto-
    // discovered SD areas), derive the CSV neighborhood string
    // directly from the slug rather than falling back to the raw
    // slug (which fails to match because slugs have dashes and
    // CSV neighborhoods have spaces).
    const known = findArea(area);
    const displayed = known?.label ?? slugToCsvNeighborhood(area);
    const matchAgainst = upstreamName(displayed).toLowerCase();
    const inArea = rows.filter((r) => r.area.toLowerCase() === matchAgainst);
    if (inArea.length === 0) return null;
    // Coarse VOLUME signal over the cached ~annual window, now bucketed
    // by self-calibrating quintile bands over San Diego's own
    // per-neighborhood distribution (case-folded to match the
    // case-insensitive area lookup) rather than absolute magic numbers;
    // degrades to the prior thresholds. Still a volume signal, NOT a
    // per-capita rate -- per-100k normalization is owned by the Safety
    // Index (safety-score.ts) and is deliberately not duplicated here.
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [200, 600, 1200, 2000], (r) => r.area.toLowerCase());
    return { area: displayed, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRows();
    const known = findArea(area);
    const displayed = known?.label ?? slugToCsvNeighborhood(area);
    const matchAgainst = upstreamName(displayed).toLowerCase();
    let filtered = rows.filter((r) => r.area.toLowerCase() === matchAgainst);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },

  async getRecentReports(area: string, opts?: { limit?: number }) {
    return this.getIncidents(area, { limit: opts?.limit ?? 20 });
  },
};
