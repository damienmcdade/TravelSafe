import "server-only";
import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";

// Cincinnati — CPD Crime Incidents.
// Socrata dataset k59e-2pvf on data.cincinnati-oh.gov. The published row
// also includes victim + suspect demographic columns; TravelSafe HARD
// REFUSES to read or surface those fields (no race, ethnicity, age, gender,
// or weapons profile) — we only request neighborhood, offense category,
// date, and coordinates. This is enforced by the $select param in fetchCin().
// Doc: https://dev.socrata.com/foundry/data.cincinnati-oh.gov/k59e-2pvf

const BASE = "https://data.cincinnati-oh.gov/resource/k59e-2pvf.json";
const ROW_LIMIT = 5_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface CinRow {
  incident_no?: string;
  offense?: string;
  ucr_group?: string;
  /// Date the incident actually occurred. Preferred over date_reported
  /// because Cincinnati publishes a significant cold-case backlog —
  /// reports with recent date_reported but date_from from years ago.
  /// Using date_from gives a representative "recent activity" signal
  /// in the 365-day rate window.
  date_from?: string;
  /// Date the report was filed. Cincinnati backlog skews this recent
  /// while the actual incident may be years old. Kept as a fallback
  /// for rows that have date_reported but no date_from.
  date_reported?: string;
  cpd_neighborhood?: string;
  latitude_x?: string;
  longitude_x?: string;
}

// CPD's ucr_group is the canonical UCR-Part-1 + Part-2 bucketing. Map to
// our 3-bucket NIBRS taxonomy:
//   PERSONS: aggravated assaults, homicide, rape, robbery
//   PROPERTY: burglary/breaking entering, theft, unauthorized use (vehicle)
//   SOCIETY: part 2 minor (catch-all) + everything else
const PERSONS_UCR = new Set(["AGGRAVATED ASSAULTS", "HOMICIDE", "RAPE", "ROBBERY"]);
const PROPERTY_UCR = new Set(["BURGLARY/BREAKING ENTERING", "THEFT", "UNAUTHORIZED USE"]);
function mapToNibrs(row: CinRow): CrimeCategory {
  const g = (row.ucr_group ?? "").trim().toUpperCase();
  if (PERSONS_UCR.has(g)) return CrimeCategory.PERSONS;
  if (PROPERTY_UCR.has(g)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

function titleCase(s: string): string {
  // Cincinnati's neighborhood values come ALL CAPS ("EAST WALNUT HILLS"); the
  // polygon file uses Title Case ("East Walnut Hills"). Normalize on intake.
  return s.toLowerCase().split(/\s+/).map((w) => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}

const PROVENANCE: DataProvenance = {
  source: "Cincinnati Police Department Crime Incidents (City of Cincinnati Open Data)",
  datasetUrl: "https://data.cincinnati-oh.gov/safety/PDI-Police-Data-Initiative-Crime-Incidents/k59e-2pvf",
  recency: "Refreshed daily by CPD; reporting lag varies (some incidents filed weeks/months after occurrence)",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Cincinnati Police Department and aggregated to " +
    "CPD's named neighborhoods. TravelSafe does NOT request or display the " +
    "victim / suspect demographic columns CPD publishes (race, ethnicity, age, " +
    "gender) — only neighborhood, offense, date, and coordinates.",
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
  // date_from (incident occurrence) DESC so the newest-50k pull covers
  // recent activity rather than the cold-case backlog that skews
  // date_reported.
  const select = "incident_no,offense,ucr_group,date_from,date_reported,cpd_neighborhood,latitude_x,longitude_x";
  const u = `${BASE}?$limit=${ROW_LIMIT}&$select=${select}&$order=date_from%20DESC&$where=date_from%20IS%20NOT%20NULL%20AND%20cpd_neighborhood%20IS%20NOT%20NULL`;
  const res = await fetch(u, {
    headers: { Accept: "application/json", "User-Agent": "TravelSafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
  });
  if (!res.ok) throw new Error(`Cincinnati Socrata ${res.status}`);
  const rows = (await res.json()) as CinRow[];
  const out: Incident[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // Prefer date_from (incident occurrence) over date_reported (filing
    // date). See CinRow comment for the cold-case backlog rationale.
    const occurredAt = safeIso(r.date_from ?? r.date_reported);
    if (!occurredAt) continue;
    const lat = Number(r.latitude_x);
    const lng = Number(r.longitude_x);
    out.push({
      id: `cin-${r.incident_no ?? i}`,
      area: r.cpd_neighborhood ? titleCase(r.cpd_neighborhood.trim()) : "Unknown",
      occurredAt,
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.offense?.trim() || r.ucr_group?.trim() || "Unknown",
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
    .filter(([, e]) => e.count >= 3)
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
