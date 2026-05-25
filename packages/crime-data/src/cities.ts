import type { CrimeDataAdapter } from "./types.js";
import type { KnownArea } from "./neighborhoods.js";
import { sdpdNibrsAdapter, getDiscoveredAreas as getDiscoveredAreasSD } from "./adapters/sdpd-nibrs.js";
import { lapdAdapter, getDiscoveredAreasLA } from "./adapters/lapd-socrata.js";
import { sfAdapter, getDiscoveredAreasSF } from "./adapters/sf-socrata.js";
import { chicagoAdapter, getDiscoveredAreasChicago } from "./adapters/chicago-socrata.js";
import { seattleAdapter, getDiscoveredAreasSeattle } from "./adapters/seattle-socrata.js";
import { nypdAdapter, getDiscoveredAreasNYC } from "./adapters/nypd-socrata.js";
// Denver retired (upstream ArcGIS feed moved behind auth in 2026).
// Adapter file is preserved at ./adapters/denver-arcgis.ts with a
// DENVER_ARCGIS_TOKEN passthrough so we can re-enable if a key is
// obtained later. Replaced by Colorado Springs.
import { coloradoSpringsAdapter, getDiscoveredAreasCoSp } from "./adapters/colorado-springs-socrata.js";
import { detroitAdapter, getDiscoveredAreasDetroit } from "./adapters/detroit-arcgis.js";
import { dcAdapter, getDiscoveredAreasDC } from "./adapters/dc-arcgis.js";
import { bostonAdapter, getDiscoveredAreasBoston } from "./adapters/boston-ckan.js";
import { phlAdapter, getDiscoveredAreasPhl } from "./adapters/phl-carto.js";
import { oaklandAdapter, getDiscoveredAreasOakland } from "./adapters/oakland-socrata.js";
import { cincinnatiAdapter, getDiscoveredAreasCincinnati } from "./adapters/cincinnati-socrata.js";
import { nolaAdapter, getDiscoveredAreasNola } from "./adapters/nola-socrata.js";
import { batonRougeAdapter, getDiscoveredAreasBatonRouge } from "./adapters/baton-rouge-socrata.js";
import { cambridgeAdapter, getDiscoveredAreasCambridge } from "./adapters/cambridge-socrata.js";
import { dallasAdapter, getDiscoveredAreasDallas } from "./adapters/dallas-socrata.js";
import { charlotteAdapter, getDiscoveredAreasCharlotte } from "./adapters/charlotte-arcgis.js";
import { nashvilleAdapter, getDiscoveredAreasNashville } from "./adapters/nashville-arcgis.js";
import { minneapolisAdapter, getDiscoveredAreasMinneapolis } from "./adapters/minneapolis-arcgis.js";
import { clevelandAdapter, getDiscoveredAreasCleveland } from "./adapters/cleveland-arcgis.js";
import { milwaukeeAdapter, getDiscoveredAreasMilwaukee } from "./adapters/milwaukee-ckan.js";
import { lasVegasAdapter, getDiscoveredAreasLasVegas } from "./adapters/las-vegas-arcgis.js";
import { boiseAdapter, getDiscoveredAreasBoise } from "./adapters/boise-arcgis.js";
import { buffaloAdapter, getDiscoveredAreasBuffalo } from "./adapters/buffalo-socrata.js";
import { norfolkAdapter, getDiscoveredAreasNorfolk } from "./adapters/norfolk-socrata.js";
import { kansasCityAdapter, getDiscoveredAreasKansasCity } from "./adapters/kansas-city-socrata.js";
import { saintPaulAdapter, getDiscoveredAreasSaintPaul } from "./adapters/saint-paul-arcgis.js";
import { pittsburghAdapter, getDiscoveredAreasPittsburgh } from "./adapters/pittsburgh-ckan.js";
import { phoenixAdapter, getDiscoveredAreasPhoenix } from "./adapters/phoenix-socrata.js";

// City registry.
//
// Only cities with verified, current public crime APIs are listed. Earlier
// iterations included Oakland (data stops in 2013), Long Beach, and San Jose
// (no usable public crime API found). They were misleading without real data
// and have been removed.
//
// To add a city: confirm a current public API, write an adapter, then add
// an entry below. See adapters/lapd-socrata.ts or sf-socrata.ts for templates.

export interface CityEntry {
  slug: string;
  label: string;
  bbox: { south: number; west: number; north: number; east: number };
  adapter: CrimeDataAdapter;
  discover: () => Promise<KnownArea[]>;
}

export const CITIES: CityEntry[] = [
  {
    slug: "san-diego",
    label: "San Diego",
    bbox: { south: 32.53, west: -117.30, north: 33.10, east: -116.90 },
    adapter: sdpdNibrsAdapter,
    discover: getDiscoveredAreasSD,
  },
  {
    slug: "los-angeles",
    label: "Los Angeles",
    bbox: { south: 33.70, west: -118.67, north: 34.34, east: -118.15 },
    adapter: lapdAdapter,
    discover: getDiscoveredAreasLA,
  },
  {
    slug: "san-francisco",
    label: "San Francisco",
    bbox: { south: 37.70, west: -122.55, north: 37.83, east: -122.35 },
    adapter: sfAdapter,
    discover: getDiscoveredAreasSF,
  },
  {
    slug: "chicago",
    label: "Chicago",
    bbox: { south: 41.64, west: -87.94, north: 42.02, east: -87.52 },
    adapter: chicagoAdapter,
    discover: getDiscoveredAreasChicago,
  },
  {
    slug: "seattle",
    label: "Seattle",
    bbox: { south: 47.50, west: -122.46, north: 47.74, east: -122.22 },
    adapter: seattleAdapter,
    discover: getDiscoveredAreasSeattle,
  },
  {
    slug: "new-york",
    label: "New York City",
    bbox: { south: 40.49, west: -74.27, north: 40.92, east: -73.68 },
    adapter: nypdAdapter,
    discover: getDiscoveredAreasNYC,
  },
  {
    slug: "colorado-springs",
    label: "Colorado Springs",
    bbox: { south: 38.70, west: -104.92, north: 39.10, east: -104.55 },
    adapter: coloradoSpringsAdapter,
    discover: getDiscoveredAreasCoSp,
  },
  {
    slug: "detroit",
    label: "Detroit",
    bbox: { south: 42.25, west: -83.29, north: 42.45, east: -82.91 },
    adapter: detroitAdapter,
    discover: getDiscoveredAreasDetroit,
  },
  {
    slug: "washington-dc",
    label: "Washington",
    bbox: { south: 38.79, west: -77.12, north: 38.99, east: -76.91 },
    adapter: dcAdapter,
    discover: getDiscoveredAreasDC,
  },
  {
    slug: "boston",
    label: "Boston",
    bbox: { south: 42.23, west: -71.19, north: 42.40, east: -70.99 },
    adapter: bostonAdapter,
    discover: getDiscoveredAreasBoston,
  },
  {
    slug: "philadelphia",
    label: "Philadelphia",
    bbox: { south: 39.87, west: -75.28, north: 40.14, east: -74.96 },
    adapter: phlAdapter,
    discover: getDiscoveredAreasPhl,
  },
  {
    slug: "oakland",
    label: "Oakland",
    bbox: { south: 37.69, west: -122.36, north: 37.89, east: -122.11 },
    adapter: oaklandAdapter,
    discover: getDiscoveredAreasOakland,
  },
  {
    slug: "cincinnati",
    label: "Cincinnati",
    bbox: { south: 39.05, west: -84.72, north: 39.22, east: -84.36 },
    adapter: cincinnatiAdapter,
    discover: getDiscoveredAreasCincinnati,
  },
  {
    slug: "new-orleans",
    label: "New Orleans",
    bbox: { south: 29.86, west: -90.14, north: 30.07, east: -89.62 },
    adapter: nolaAdapter,
    discover: getDiscoveredAreasNola,
  },
  {
    slug: "baton-rouge",
    label: "Baton Rouge",
    bbox: { south: 30.30, west: -91.27, north: 30.59, east: -91.00 },
    adapter: batonRougeAdapter,
    discover: getDiscoveredAreasBatonRouge,
  },
  {
    slug: "cambridge",
    label: "Cambridge",
    bbox: { south: 42.34, west: -71.16, north: 42.41, east: -71.07 },
    adapter: cambridgeAdapter,
    discover: getDiscoveredAreasCambridge,
  },
  {
    slug: "dallas",
    label: "Dallas",
    bbox: { south: 32.62, west: -96.99, north: 33.02, east: -96.55 },
    adapter: dallasAdapter,
    discover: getDiscoveredAreasDallas,
  },
  {
    slug: "charlotte",
    label: "Charlotte",
    bbox: { south: 35.00, west: -81.00, north: 35.40, east: -80.62 },
    adapter: charlotteAdapter,
    discover: getDiscoveredAreasCharlotte,
  },
  {
    slug: "nashville",
    label: "Nashville",
    bbox: { south: 35.97, west: -87.05, north: 36.41, east: -86.51 },
    adapter: nashvilleAdapter,
    discover: getDiscoveredAreasNashville,
  },
  {
    slug: "minneapolis",
    label: "Minneapolis",
    bbox: { south: 44.89, west: -93.33, north: 45.05, east: -93.19 },
    adapter: minneapolisAdapter,
    discover: getDiscoveredAreasMinneapolis,
  },
  {
    slug: "cleveland",
    label: "Cleveland",
    bbox: { south: 41.39, west: -81.97, north: 41.61, east: -81.53 },
    adapter: clevelandAdapter,
    discover: getDiscoveredAreasCleveland,
  },
  {
    // Replaced Montgomery County (county-level, ambiguous to users) with
    // Milwaukee — a real city with an actively-maintained CKAN dataset
    // (WIBR Group A) on data.milwaukee.gov, ~9k incidents grouped by ZIP.
    slug: "milwaukee",
    label: "Milwaukee",
    bbox: { south: 42.92, west: -88.07, north: 43.20, east: -87.83 },
    adapter: milwaukeeAdapter,
    discover: getDiscoveredAreasMilwaukee,
  },
  {
    slug: "las-vegas",
    label: "Las Vegas",
    bbox: { south: 35.99, west: -115.40, north: 36.40, east: -114.95 },
    adapter: lasVegasAdapter,
    discover: getDiscoveredAreasLasVegas,
  },
  {
    slug: "boise",
    label: "Boise",
    bbox: { south: 43.50, west: -116.40, north: 43.75, east: -116.05 },
    adapter: boiseAdapter,
    discover: getDiscoveredAreasBoise,
  },
  {
    slug: "buffalo",
    label: "Buffalo",
    bbox: { south: 42.83, west: -78.92, north: 42.97, east: -78.79 },
    adapter: buffaloAdapter,
    discover: getDiscoveredAreasBuffalo,
  },
  {
    // Replaced Tucson (May 2026) — TPD only published a rolling
    // Last-45-Days layer with no historical alternative, which
    // produced perpetually-noisy scores. Norfolk publishes a full
    // 108k-incident dataset on data.norfolk.gov with daily updates.
    slug: "norfolk",
    label: "Norfolk",
    bbox: { south: 36.79, west: -76.34, north: 36.97, east: -76.18 },
    adapter: norfolkAdapter,
    discover: getDiscoveredAreasNorfolk,
  },
  {
    slug: "kansas-city",
    label: "Kansas City",
    bbox: { south: 38.85, west: -94.78, north: 39.30, east: -94.40 },
    adapter: kansasCityAdapter,
    discover: getDiscoveredAreasKansasCity,
  },
  {
    slug: "saint-paul",
    label: "Saint Paul",
    bbox: { south: 44.87, west: -93.22, north: 45.01, east: -93.00 },
    adapter: saintPaulAdapter,
    discover: getDiscoveredAreasSaintPaul,
  },
  {
    slug: "pittsburgh",
    label: "Pittsburgh",
    bbox: { south: 40.36, west: -80.10, north: 40.50, east: -79.86 },
    adapter: pittsburghAdapter,
    discover: getDiscoveredAreasPittsburgh,
  },
  {
    // Phoenix — 30th live city. Adapter pulls phoenixopendata.com's
    // CKAN datastore (newest 50k incidents in 5 parallel pages), groups
    // by ZIP, attaches Phoenix Urban Village labels where the ZIP maps
    // to one cleanly.
    slug: "phoenix",
    label: "Phoenix",
    bbox: { south: 33.29, west: -112.32, north: 33.72, east: -111.93 },
    adapter: phoenixAdapter,
    discover: getDiscoveredAreasPhoenix,
  },
];

export function cityFromLatLng(point: { lat: number; lng: number }): CityEntry | null {
  for (const c of CITIES) {
    if (point.lat >= c.bbox.south && point.lat <= c.bbox.north && point.lng >= c.bbox.west && point.lng <= c.bbox.east) {
      return c;
    }
  }
  return null;
}

/// Closest tracked city by great-circle distance from the point to the
/// city's bbox centroid. Used as a fallback when cityFromLatLng()
/// returns null — a user just outside SD's bbox (e.g., Tijuana side
/// of the border, or El Cajon) shouldn't see an outside_coverage
/// error when SD is obviously their nearest tracked city. Returns
/// the city and the haversine distance in km so the caller can
/// decide if they're close enough to be useful.
export function nearestCityByCentroid(point: { lat: number; lng: number }): { city: CityEntry; km: number } | null {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  let best: { city: CityEntry; km: number } | null = null;
  for (const c of CITIES) {
    const cx = (c.bbox.south + c.bbox.north) / 2;
    const cy = (c.bbox.west + c.bbox.east) / 2;
    const km = haversineKm(point, { lat: cx, lng: cy });
    if (!best || km < best.km) best = { city: c, km };
  }
  return best;
}

/// Route an area slug to its city. Slugs are prefixed by adapter
/// (la-*, sf-*, chi-*); bare slugs default to San Diego.
export function cityForArea(slug: string): CityEntry {
  if (slug.startsWith("la-")  || slug === "los-angeles")   return CITIES[1];
  if (slug.startsWith("sf-")  || slug === "san-francisco") return CITIES[2];
  if (slug.startsWith("chi-") || slug === "chicago")       return CITIES[3];
  if (slug.startsWith("sea-") || slug === "seattle")       return CITIES[4];
  if (slug.startsWith("ny-")  || slug === "new-york")      return CITIES[5];
  if (slug.startsWith("cosp-") || slug === "colorado-springs") return CITIES[6];
  // Legacy /den- slugs (Denver retired) fall through to the default
  // city lookup — bookmarks won't crash; they just won't resolve.
  if (slug.startsWith("det-") || slug === "detroit")       return CITIES[7];
  if (slug.startsWith("dc-")  || slug === "washington-dc") return CITIES[8];
  if (slug.startsWith("bos-") || slug === "boston")        return CITIES[9];
  if (slug.startsWith("phl-") || slug === "philadelphia")  return CITIES[10];
  if (slug.startsWith("oak-") || slug === "oakland")       return CITIES[11];
  if (slug.startsWith("cin-")  || slug === "cincinnati")   return CITIES[12];
  if (slug.startsWith("nola-") || slug === "new-orleans")  return CITIES[13];
  if (slug.startsWith("br-")   || slug === "baton-rouge")  return CITIES[14];
  if (slug.startsWith("cam-")  || slug === "cambridge")    return CITIES[15];
  if (slug.startsWith("dal-")  || slug === "dallas")       return CITIES[16];
  if (slug.startsWith("clt-")  || slug === "charlotte")    return CITIES[17];
  if (slug.startsWith("nas-")  || slug === "nashville")    return CITIES[18];
  if (slug.startsWith("mpls-") || slug === "minneapolis")  return CITIES[19];
  if (slug.startsWith("cle-")  || slug === "cleveland")    return CITIES[20];
  if (slug.startsWith("mke-")  || slug === "milwaukee")    return CITIES[21];
  if (slug.startsWith("lv-")   || slug === "las-vegas")    return CITIES[22];
  if (slug.startsWith("bzi-")  || slug === "boise")        return CITIES[23];
  if (slug.startsWith("buf-")  || slug === "buffalo")      return CITIES[24];
  if (slug.startsWith("nor-")  || slug === "norfolk")      return CITIES[25];
  if (slug.startsWith("kc-")   || slug === "kansas-city")  return CITIES[26];
  if (slug.startsWith("sp-")   || slug === "saint-paul")   return CITIES[27];
  if (slug.startsWith("pgh-")  || slug === "pittsburgh")   return CITIES[28];
  if (slug.startsWith("phx-")  || slug === "phoenix")      return CITIES[29];
  return CITIES[0];
}

export function cityBySlug(slug: string): CityEntry | null {
  return CITIES.find((c) => c.slug === slug) ?? null;
}
