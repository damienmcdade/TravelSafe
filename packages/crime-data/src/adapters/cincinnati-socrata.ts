import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import type { KnownArea } from "../neighborhoods.js";
import { socrataHeaders } from "../lib/http.js";

// Cincinnati — Reported Crime (STARS Category Offenses) on or after
// 6/3/2024. Socrata dataset 7aqy-xrv9 on data.cincinnati-oh.gov.
//
// The legacy "PDI Crime Incidents" dataset (k59e-2pvf) stopped
// accepting new incidents around 2020 — by the time of this adapter
// rewrite the newest date_from was 2020-06-19, which fell outside
// the safety-score 365d wall-clock window and broke every Cincinnati
// score in production. CPD migrated active reporting to the STARS
// schema (separate before/after 2024-06-03 datasets); 7aqy-xrv9
// holds everything since then and updates daily.
//
// The new dataset uses `type` to label Part 1 vs Part 2 and
// `stars_category` for the offense — different mapping than the old
// ucr_group field. Field names also dropped underscores in the
// date columns (`datefrom` instead of `date_from`).
//
// Still NEVER request demographic columns. The 7aqy-xrv9 schema
// doesn't even publish them, but the $select is kept explicit so a
// future schema addition doesn't accidentally pull them.

const BASE = "https://data.cincinnati-oh.gov/resource/7aqy-xrv9.json";
const ROW_LIMIT = 50_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface CinRow {
  incident_no?: string;
  /// e.g. "Theft from Auto", "Aggravated Assault" — the canonical
  /// STARS offense label.
  stars_category?: string;
  /// "Part 1 Violent", "Part 1 Property", "Part 2 Minor" — the FBI
  /// UCR Part-1/Part-2 classification. Maps cleanly to our NIBRS
  /// three-bucket taxonomy.
  type?: string;
  /// Date the incident occurred (camelCase, no underscore in the new
  /// schema). Preferred over datereported.
  datefrom?: string;
  /// Date the report was filed. Kept as a fallback when datefrom is
  /// missing — same rationale as the legacy adapter.
  datereported?: string;
  cpd_neighborhood?: string;
  latitude_x?: string;
  longitude_x?: string;
}

// Map the STARS `type` field to our 3-bucket NIBRS taxonomy. The
// labels are stable across the dataset and the bucketing matches
// the FBI's own UCR Part 1 (Violent vs Property) + Part 2 (Society).
function mapToNibrs(row: CinRow): CrimeCategory {
  const t = (row.type ?? "").trim().toLowerCase();
  if (t.includes("part 1 violent")) return CrimeCategory.PERSONS;
  if (t.includes("part 1 property")) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

function titleCase(s: string): string {
  // Cincinnati's neighborhood values come ALL CAPS ("EAST WALNUT HILLS"); the
  // polygon file uses Title Case ("East Walnut Hills"). Normalize on intake.
  return s.toLowerCase().split(/\s+/).map((w) => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}

const PROVENANCE: DataProvenance = {
  source: "Cincinnati Police Department Reported Crime (STARS) — on or after 6/3/2024 (City of Cincinnati Open Data)",
  datasetUrl: "https://data.cincinnati-oh.gov/Safety/Reported-Crime-STARS-Category-Offenses-on-or-after/7aqy-xrv9",
  recency: "Refreshed daily by CPD; reporting lag varies (some incidents filed weeks/months after occurrence)",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Cincinnati Police Department and aggregated to " +
    "CPD's named neighborhoods. CommunitySafe does NOT request or display any " +
    "victim / suspect demographic columns — only neighborhood, offense, date, and " +
    "coordinates.",
};

/// Parse a date string, returning null when invalid. See kansas-city
/// adapter for the rationale — epoch-fallback rows pollute the citywide
/// aggregator and collapse windowDays.
function safeIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime()) || d.getTime() <= 0) return null;
  return d.toISOString();
}

async function fetchCin(): Promise<Incident[]> {
  // Explicit $select — never request demographic columns. Order by
  // datefrom (incident occurrence) DESC so the newest pull covers
  // recent activity rather than backlog that skews datereported.
  const select = "incident_no,stars_category,type,datefrom,datereported,cpd_neighborhood,latitude_x,longitude_x";
  const u = `${BASE}?$limit=${ROW_LIMIT}&$select=${select}&$order=datefrom%20DESC&$where=datefrom%20IS%20NOT%20NULL%20AND%20cpd_neighborhood%20IS%20NOT%20NULL`;
  const res = await fetch(u, {
    headers: socrataHeaders(u),
  });
  if (!res.ok) throw new Error(`Cincinnati Socrata ${res.status}`);
  const rows = (await res.json()) as CinRow[];
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // Prefer datefrom (incident occurrence) over datereported (filing
    // date). See CinRow comment for the rationale.
    const occurredAt = safeIso(r.datefrom ?? r.datereported);
    if (!occurredAt) continue;
    const lat = Number(r.latitude_x);
    const lng = Number(r.longitude_x);
    out.push({
      id: `cin-${r.incident_no ?? i}`,
      area: r.cpd_neighborhood ? titleCase(r.cpd_neighborhood.trim()) : "Unknown",
      occurredAt,
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.stars_category?.trim() || r.type?.trim() || "Unknown",
      beat: null,
      blockLabel: undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lng) && lng !== 0 ? lng : undefined,
    });
  }
  return out;
}

export async function getRowsCincinnati(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchCin();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[cincinnati] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasCincinnati(): Promise<KnownArea[]> {
  const rows = await getRowsCincinnati();
  const agg = new Map<string, { latSum: number; lngSum: number; count: number }>();
  for (const r of rows) {
    if (!r.area || r.area === "Unknown") continue;
    if (r.lat == null || r.lng == null) continue;
    const e = agg.get(r.area) ?? { latSum: 0, lngSum: 0, count: 0 };
    e.latSum += r.lat; e.lngSum += r.lng; e.count += 1;
    agg.set(r.area, e);
  }
  return Array.from(agg.entries())
    .filter(([, e]) => e.count >= 1)  // v89 — was 3; Cincinnati has 52 official SNAs
    .map(([name, e]) => ({
      slug: `cin-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Cincinnati",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForCincinnatiSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("cin-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  return null;
}

export const cincinnatiAdapter: CrimeDataAdapter = {
  name: "cincinnati-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsCincinnati();
    const label = labelForCincinnatiSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 300 ? 5 : inArea.length > 160 ? 4 : inArea.length > 80 ? 3 : inArea.length > 30 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsCincinnati();
    const label = labelForCincinnatiSlug(area, rows);
    if (!label) return [];
    let filtered = rows.filter((r) => r.area === label);
    if (opts?.since) filtered = filtered.filter((r) => new Date(r.occurredAt) >= opts.since!);
    filtered.sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    return filtered.slice(0, opts?.limit ?? 50);
  },

  async getRecentReports(area: string, opts?: { limit?: number }) {
    return this.getIncidents(area, { limit: opts?.limit ?? 20 });
  },
};
