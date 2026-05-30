import { CrimeCategory } from "../crime-category.js";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";
import type { KnownArea } from "../neighborhoods.js";
import { fetchSocrata } from "../lib/http.js";
import { riskLevelFromAreaCounts } from "../risk-bands.js";
import { titleCaseOffense } from "../lib/titlecase-offense.js";
import { cityLocalToUtcIso } from "../lib/city-time.js";

// City of Chicago — Crimes 2001 to Present.
// Socrata dataset ijzp-q8t2 on data.cityofchicago.org. The original public
// crime dataset that other municipal portals later modeled themselves on.
// Doc: https://dev.socrata.com/foundry/data.cityofchicago.org/ijzp-q8t2

const BASE = "https://data.cityofchicago.org/resource/ijzp-q8t2.json";
// 5-minute cache: half the client's 10-minute refresh window (see sibling
// adapters for the rationale).
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[]; areaByNum: Map<number, string> } | null = null;
registerRowCache(() => { cache = null; });

interface SodaRow {
  id?: string;
  primary_type?: string;
  description?: string;
  community_area?: string;        // numeric string, 1-77
  date?: string;                  // ISO timestamp
  latitude?: string;
  longitude?: string;
  beat?: string;
  district?: string;
  location_description?: string;
  fbi_code?: string;
}

// Chicago's 77 official Community Areas, indexed by `community_area` number.
// Pulled from the matching cityofchicago.org polygon dataset (igwz-8jzy).
// Centralized here so the same lookup powers both incident.area and the area
// discovery. The polygon file under /public/geo/chicago.geojson carries the
// same name set in `properties.name`.
const COMMUNITY_AREAS: Record<number, string> = {
  1:"Rogers Park", 2:"West Ridge", 3:"Uptown", 4:"Lincoln Square", 5:"North Center",
  6:"Lake View", 7:"Lincoln Park", 8:"Near North Side", 9:"Edison Park", 10:"Norwood Park",
  11:"Jefferson Park", 12:"Forest Glen", 13:"North Park", 14:"Albany Park", 15:"Portage Park",
  16:"Irving Park", 17:"Dunning", 18:"Montclare", 19:"Belmont Cragin", 20:"Hermosa",
  21:"Avondale", 22:"Logan Square", 23:"Humboldt Park", 24:"West Town", 25:"Austin",
  26:"West Garfield Park", 27:"East Garfield Park", 28:"Near West Side", 29:"North Lawndale",
  30:"South Lawndale", 31:"Lower West Side", 32:"Loop", 33:"Near South Side", 34:"Armour Square",
  35:"Douglas", 36:"Oakland", 37:"Fuller Park", 38:"Grand Boulevard", 39:"Kenwood",
  40:"Washington Park", 41:"Hyde Park", 42:"Woodlawn", 43:"South Shore", 44:"Chatham",
  45:"Avalon Park", 46:"South Chicago", 47:"Burnside", 48:"Calumet Heights", 49:"Roseland",
  50:"Pullman", 51:"South Deering", 52:"East Side", 53:"West Pullman", 54:"Riverdale",
  55:"Hegewisch", 56:"Garfield Ridge", 57:"Archer Heights", 58:"Brighton Park", 59:"McKinley Park",
  60:"Bridgeport", 61:"New City", 62:"West Elsdon", 63:"Gage Park", 64:"Clearing",
  65:"West Lawn", 66:"Chicago Lawn", 67:"West Englewood", 68:"Englewood", 69:"Greater Grand Crossing",
  70:"Ashburn", 71:"Auburn Gresham", 72:"Beverly", 73:"Washington Heights", 74:"Mount Greenwood",
  75:"Morgan Park", 76:"O'Hare", 77:"Edgewater",
};

// Map Chicago's `primary_type` to the three-bucket NIBRS-style category our
// UI uses. Where Chicago's bucket clearly maps to PERSONS or PROPERTY we
// place it there; anything ambiguous goes to SOCIETY.
const PERSONS_TYPES = new Set([
  "ASSAULT", "BATTERY", "ROBBERY", "HOMICIDE", "CRIM SEXUAL ASSAULT", "CRIMINAL SEXUAL ASSAULT",
  "KIDNAPPING", "HUMAN TRAFFICKING",
  "INTIMIDATION", "STALKING",
  // v99 — removed "SEX OFFENSE" (Chicago's non-rape bucket: criminal sexual
  // ABUSE, public indecency — NOT UCR Part-1; true rape is the separate
  // "CRIM SEXUAL ASSAULT" type, kept above) and "OFFENSE INVOLVING CHILDREN"
  // (endangerment, abandonment — not Part-1). Both were being counted as
  // violent, contributing to the ~1.85x over-count.
]);

// v99 — Chicago's authoritative FBI/UCR code drives the Part-1 violent
// determination, because the `description` modifier isn't reliable (empty or
// abbreviated on many rows, leaking simple assault/battery into the violent
// count). Map the violent codes to canonical descriptions the shared deny-list
// scores correctly: 08A/08B simple → excluded by /\bsimple\b/; 04A/04B
// aggravated → counted (04B aggravated DOMESTIC battery too, which the raw
// "domestic" description had wrongly dropped); 02 = forcible rape; 03 robbery;
// 01A/01B homicide.
const FBI_PART1_VIOLENT_DESC: Record<string, string> = {
  "01A": "Homicide", "01B": "Homicide",
  "02": "Criminal Sexual Assault", "03": "Robbery",
  "04A": "Aggravated Assault", "04B": "Aggravated Battery",
  "08A": "Simple Assault", "08B": "Simple Battery",
};
const PROPERTY_TYPES = new Set([
  // ROBBERY intentionally NOT here — Chicago's own UCR taxonomy lists it
  // alongside the violent persons offenses and we honor that for the user-
  // facing color treatment. PERSONS_TYPES above already covers it.
  "THEFT", "BURGLARY", "MOTOR VEHICLE THEFT", "ARSON",
  "CRIMINAL DAMAGE", "CRIMINAL TRESPASS", "DECEPTIVE PRACTICE",
  "OBSCENITY", "STOLEN PROPERTY",
]);
function mapToNibrs(row: SodaRow): CrimeCategory {
  const t = (row.primary_type ?? "").trim().toUpperCase();
  if (PERSONS_TYPES.has(t)) return CrimeCategory.PERSONS;
  if (PROPERTY_TYPES.has(t)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

const PROVENANCE: DataProvenance = {
  source: "Chicago Crimes 2001-Present (City of Chicago Open Data)",
  datasetUrl: "https://data.cityofchicago.org/Public-Safety/Crimes-2001-to-Present/ijzp-q8t2",
  recency: "Refreshed daily by the Chicago Police Department; ~1-week reporting lag",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the Chicago Police Department and aggregated " +
    "to Chicago's 77 Community Areas — not live, not street-level. CommunitySafe " +
    "does not track individuals.",
};

async function fetchChicago(): Promise<{ rows: Incident[]; areaByNum: Map<number, string> }> {
  // v96 — migrated to fetchSocrata helper.
  // v96p2 — 180-day recent window per the deployment-log scan.
  const sodaRows = await fetchSocrata<SodaRow>("Chicago SODA", {
    url: BASE,
    select: "id,primary_type,description,community_area,date,latitude,longitude,beat,district,fbi_code",
    windowDays: 180,
    dateField: "date",
    order: "date DESC",
    limit: 50000,
  });
  const areaByNum = new Map<number, string>();
  const rows: Incident[] = sodaRows.map((r, i) => {
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    const caNum = Number(r.community_area);
    const areaName = Number.isFinite(caNum) && COMMUNITY_AREAS[caNum] ? COMMUNITY_AREAS[caNum] : "Unknown";
    if (areaName !== "Unknown") areaByNum.set(caNum, areaName);
    return {
      id: `chi-${r.id ?? i}`,
      area: areaName,
      // v96p2 — Chicago `date` is wall-clock CT local time.
      occurredAt: cityLocalToUtcIso(r.date, "America/Chicago"),
      nibrsCategory: mapToNibrs(r),
      // Prefer the fbi_code-canonical descriptor for assault/battery/robbery/
      // homicide/CSA so the Part-1 violent filter is driven by the authoritative
      // UCR code, not the unreliable free-text modifier. Falls back to the raw
      // description for everything else (property, etc.).
      ibrOffenseDescription: titleCaseOffense(
        FBI_PART1_VIOLENT_DESC[(r.fbi_code ?? "").trim().toUpperCase()] || r.description || r.primary_type,
      ),
      beat: r.beat ?? null,
      blockLabel: undefined,
      lat: !isNaN(lat) && lat !== 0 ? lat : undefined,
      lng: !isNaN(lon) && lon !== 0 ? lon : undefined,
    };
  });
  return { rows, areaByNum };
}

export async function getRowsChicago(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const { rows, areaByNum } = await fetchChicago();
    if (rows.length > 0) cache = { fetchedAt: now, rows, areaByNum };
    return rows;
  } catch (err) {
    console.warn("[chicago] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasChicago(): Promise<KnownArea[]> {
  const rows = await getRowsChicago();
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
      slug: `chi-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: name,
      jurisdiction: "Chicago",
      centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function labelForChicagoSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("chi-") ? s.slice(4) : s;
  for (const r of rows) {
    const candidate = r.area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (candidate === want) return r.area;
  }
  for (const r of rows) {
    if (r.area.toLowerCase() === s) return r.area;
  }
  return null;
}

export const chicagoAdapter: CrimeDataAdapter = {
  name: "chicago-socrata",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsChicago();
    const label = labelForChicagoSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    // Self-calibrating quintile bands over Chicago's own per-neighborhood
    // distribution; degrades to the prior hand-tuned thresholds.
    const riskLevel = riskLevelFromAreaCounts(rows, inArea.length, [200, 600, 1200, 2000]);
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsChicago();
    const label = labelForChicagoSlug(area, rows);
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
