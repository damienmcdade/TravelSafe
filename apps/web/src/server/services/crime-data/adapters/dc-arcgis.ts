import "server-only";
import { CrimeCategory } from "@prisma/client";
import type { AreaStats, CrimeDataAdapter, DataProvenance, Incident } from "../types";
import type { KnownArea } from "../neighborhoods";

// Washington DC — MPD Crime Incidents.
// ArcGIS MapServer at maps2.dcgis.dc.gov. Layer 39 is the rolling "last 30
// days" feed; we use it instead of the calendar-year layers so we never have
// to stitch across year boundaries and the data is always fresh.
// Doc: https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/MPD/MapServer/39

const BASE = "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/MPD/MapServer/39/query";
const PAGE_SIZE = 2000;
const PAGES = 5;                // 10,000 rows ceiling (30-day window usually 2-3k anyway)
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; rows: Incident[] } | null = null;

interface DcRow {
  CCN?: string;
  OFFENSE?: string;
  METHOD?: string;
  START_DATE?: number;             // epoch ms
  NEIGHBORHOOD_CLUSTER?: string;   // "Cluster 6"
  WARD?: string;
  DISTRICT?: string;
  LATITUDE?: number;
  LONGITUDE?: number;
}

const PERSONS_OFFENSES = new Set([
  "HOMICIDE", "ASSAULT W/DANGEROUS WEAPON", "ROBBERY", "SEX ABUSE",
]);
const PROPERTY_OFFENSES = new Set([
  "THEFT/OTHER", "THEFT F/AUTO", "MOTOR VEHICLE THEFT",
  "BURGLARY", "ARSON",
]);
function mapToNibrs(row: DcRow): CrimeCategory {
  const o = (row.OFFENSE ?? "").trim().toUpperCase();
  if (PERSONS_OFFENSES.has(o)) return CrimeCategory.PERSONS;
  if (PROPERTY_OFFENSES.has(o)) return CrimeCategory.PROPERTY;
  return CrimeCategory.SOCIETY;
}

// DC's 46 Neighborhood Clusters with their underlying named neighborhoods.
// Sourced verbatim from opendata.dc.gov DCGIS Neighborhood Clusters dataset
// (NBH_NAMES property). "Cluster 6" alone reads as gibberish to users, so
// every UI surface displays the cluster number alongside its neighborhood
// list. The polygon file under /public/geo/washington-dc.geojson carries the
// same composed strings as its `name` property.
const CLUSTER_NEIGHBORHOODS: Record<string, string> = {
  "Cluster 1":  "Kalorama Heights, Adams Morgan, Lanier Heights",
  "Cluster 2":  "Columbia Heights, Mt. Pleasant, Pleasant Plains, Park View",
  "Cluster 3":  "Howard University, Le Droit Park, Cardozo/Shaw",
  "Cluster 4":  "Georgetown, Burleith/Hillandale",
  "Cluster 5":  "West End, Foggy Bottom, GWU",
  "Cluster 6":  "Dupont Circle, Connecticut Avenue/K Street",
  "Cluster 7":  "Shaw, Logan Circle",
  "Cluster 8":  "Downtown, Chinatown, Penn Quarters, Mount Vernon Square, North Capitol Street",
  "Cluster 9":  "Southwest Employment Area, Southwest/Waterfront, Fort McNair, Buzzard Point",
  "Cluster 10": "Hawthorne, Barnaby Woods, Chevy Chase",
  "Cluster 11": "Friendship Heights, American University Park, Tenleytown",
  "Cluster 12": "North Cleveland Park, Forest Hills, Van Ness",
  "Cluster 13": "Spring Valley, Palisades, Wesley Heights, Foxhall Crescent, Foxhall Village, Georgetown Reservoir",
  "Cluster 14": "Cathedral Heights, McLean Gardens, Glover Park",
  "Cluster 15": "Cleveland Park, Woodley Park, Massachusetts Avenue Heights, Woodland-Normanstone Terrace",
  "Cluster 16": "Colonial Village, Shepherd Park, North Portal Estates",
  "Cluster 17": "Takoma, Brightwood, Manor Park",
  "Cluster 18": "Brightwood Park, Crestwood, Petworth",
  "Cluster 19": "Lamont Riggs, Queens Chapel, Fort Totten, Pleasant Hill",
  "Cluster 20": "North Michigan Park, Michigan Park, University Heights",
  "Cluster 21": "Edgewood, Bloomingdale, Truxton Circle, Eckington",
  "Cluster 22": "Brookland, Brentwood, Langdon",
  "Cluster 23": "Ivy City, Arboretum, Trinidad, Carver Langston",
  "Cluster 24": "Woodridge, Fort Lincoln, Gateway",
  "Cluster 25": "Union Station, Stanton Park, Kingman Park",
  "Cluster 26": "Capitol Hill, Lincoln Park",
  "Cluster 27": "Near Southeast, Navy Yard",
  "Cluster 28": "Historic Anacostia",
  "Cluster 29": "Eastland Gardens, Kenilworth",
  "Cluster 30": "Mayfair, Hillbrook, Mahaning Heights",
  "Cluster 31": "Deanwood, Burrville, Grant Park, Lincoln Heights, Fairmont Heights",
  "Cluster 32": "River Terrace, Benning, Greenway, Dupont Park",
  "Cluster 33": "Capitol View, Marshall Heights, Benning Heights",
  "Cluster 34": "Twining, Fairlawn, Randle Highlands, Penn Branch, Fort Davis Park, Fort Dupont",
  "Cluster 35": "Fairfax Village, Naylor Gardens, Hillcrest, Summit Park",
  "Cluster 36": "Woodland/Fort Stanton, Garfield Heights, Knox Hill",
  "Cluster 37": "Sheridan, Barry Farm, Buena Vista",
  "Cluster 38": "Douglas, Shipley Terrace",
  "Cluster 39": "Congress Heights, Bellevue, Washington Highlands",
  "Cluster 40": "Walter Reed",
  "Cluster 41": "Rock Creek Park",
  "Cluster 42": "Observatory Circle",
  "Cluster 43": "Saint Elizabeths",
  "Cluster 44": "Joint Base Anacostia-Bolling",
  "Cluster 45": "National Mall, Potomac River",
  "Cluster 46": "Arboretum, Anacostia River",
};

/// "Cluster 6" → "Cluster 6: Dupont Circle, Connecticut Avenue/K Street".
/// Falls back to the bare cluster ID if the number is unknown.
function enrich(cluster: string | undefined): string {
  if (!cluster) return "Unknown";
  const tag = cluster.trim();
  const nbh = CLUSTER_NEIGHBORHOODS[tag];
  return nbh ? `${tag}: ${nbh}` : tag;
}

const PROVENANCE: DataProvenance = {
  source: "DC MPD Crime Incidents — Last 30 Days (Open Data DC, ArcGIS MapServer)",
  datasetUrl: "https://opendata.dc.gov/datasets/DCGIS::crime-incidents-last-30-days",
  recency: "Refreshed daily by the Metropolitan Police Department",
  granularity: "neighborhood",
  disclaimer:
    "Incidents are reported by the DC Metropolitan Police Department and " +
    "aggregated to DC's 46 Neighborhood Clusters — not live, not street-level. " +
    "TravelSafe does not track individuals.",
};

async function fetchPage(offset: number): Promise<DcRow[]> {
  const url = new URL(BASE);
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "CCN,OFFENSE,METHOD,START_DATE,NEIGHBORHOOD_CLUSTER,WARD,DISTRICT,LATITUDE,LONGITUDE");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("orderByFields", "START_DATE DESC");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("f", "json");
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "TravelSafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
  });
  if (!res.ok) throw new Error(`DC ArcGIS ${res.status} offset=${offset}`);
  const body = await res.json() as { features?: Array<{ attributes: DcRow }> };
  return (body.features ?? []).map((f) => f.attributes);
}

async function fetchDC(): Promise<Incident[]> {
  const pages = await Promise.all(
    Array.from({ length: PAGES }, (_, i) => fetchPage(i * PAGE_SIZE).catch(() => [] as DcRow[])),
  );
  const rows = pages.flat();
  return rows.map((r, i) => {
    const lat = r.LATITUDE;
    const lon = r.LONGITUDE;
    return {
      id: `dc-${r.CCN ?? i}`,
      area: enrich(r.NEIGHBORHOOD_CLUSTER),
      occurredAt: r.START_DATE ? new Date(r.START_DATE).toISOString() : new Date(0).toISOString(),
      nibrsCategory: mapToNibrs(r),
      ibrOffenseDescription: r.OFFENSE?.trim() || "Unknown",
      beat: r.DISTRICT ?? null,
      blockLabel: undefined,
      lat: typeof lat === "number" && lat !== 0 ? lat : undefined,
      lng: typeof lon === "number" && lon !== 0 ? lon : undefined,
    };
  });
}

export async function getRowsDC(): Promise<Incident[]> {
  const now = Date.now();
  if (cache && cache.rows.length > 0 && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;
  try {
    const rows = await fetchDC();
    if (rows.length > 0) cache = { fetchedAt: now, rows };
    return rows;
  } catch (err) {
    console.warn("[dc] fetch failed:", (err as Error).message);
    return cache?.rows ?? [];
  }
}

export async function getDiscoveredAreasDC(): Promise<KnownArea[]> {
  const rows = await getRowsDC();
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
    .map(([name, e]) => {
      // Cluster number drives the slug for compactness.
      const clusterTag = name.split(":")[0].trim().replace(/\s+/g, "-").toLowerCase(); // "Cluster 6" → "cluster-6"
      return {
        slug: `dc-${clusterTag}`,
        label: name,
        jurisdiction: "Washington",
        centroid: { lat: e.latSum / e.count, lng: e.lngSum / e.count },
      };
    })
    .sort((a, b) => {
      // Sort by cluster number, not alpha — so "Cluster 2" < "Cluster 10".
      const na = parseInt(a.label.replace(/\D+/, ""), 10) || 999;
      const nb = parseInt(b.label.replace(/\D+/, ""), 10) || 999;
      return na - nb;
    });
}

function labelForDCSlug(slug: string, rows: Incident[]): string | null {
  const s = slug.toLowerCase();
  const want = s.startsWith("dc-") ? s.slice(3) : s;
  // Compact cluster tag like "cluster-6" → "Cluster 6"
  const wantTag = want.replace(/-/g, " ").trim();
  for (const r of rows) {
    const headTag = r.area.split(":")[0].trim().toLowerCase();
    if (headTag === wantTag) return r.area;
  }
  return null;
}

export const dcAdapter: CrimeDataAdapter = {
  name: "dc-mpd-arcgis",

  async getAreaStats(area: string): Promise<AreaStats | null> {
    const rows = await getRowsDC();
    const label = labelForDCSlug(area, rows);
    if (!label) return null;
    const inArea = rows.filter((r) => r.area === label);
    if (inArea.length === 0) return null;
    const riskLevel: 1 | 2 | 3 | 4 | 5 = inArea.length > 300 ? 5 : inArea.length > 160 ? 4 : inArea.length > 80 ? 3 : inArea.length > 30 ? 2 : 1;
    return { area: label, crimeRate: null, violentCrimeRate: null, propertyCrimeRate: null, riskLevel, provenance: PROVENANCE };
  },

  async getIncidents(area: string, opts?: { limit?: number; since?: Date }) {
    const rows = await getRowsDC();
    const label = labelForDCSlug(area, rows);
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
