import type { CrimeDataAdapter } from "./types.js";
import type { KnownArea } from "./neighborhoods.js";
import { sdpdNibrsAdapter, getDiscoveredAreas as getDiscoveredAreasSD } from "./adapters/sdpd-nibrs.js";
import { lapdAdapter, getDiscoveredAreasLA } from "./adapters/lapd-socrata.js";
import { sfAdapter, getDiscoveredAreasSF } from "./adapters/sf-socrata.js";
import { chicagoAdapter, getDiscoveredAreasChicago } from "./adapters/chicago-socrata.js";
import { seattleAdapter, getDiscoveredAreasSeattle } from "./adapters/seattle-socrata.js";
import { nypdAdapter, getDiscoveredAreasNYC } from "./adapters/nypd-socrata.js";
// v70 — Denver UN-retired. The "Token Required" gate that shut the
// public crime FeatureServer in May 2026 was lifted upstream by
// 2026-05-25. The endpoint now serves anonymously again — verified
// from Railway IP returning fresh through 2026-05-21. Re-imported
// alongside Colorado Springs (CoSp stayed as the metro fallback).
import { denverAdapter, getDiscoveredAreasDenver } from "./adapters/denver-arcgis.js";
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
import { baltimoreAdapter, getDiscoveredAreasBaltimore } from "./adapters/baltimore-arcgis.js";
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
import { fortWorthAdapter, getDiscoveredAreasFortWorth } from "./adapters/fort-worth-arcgis.js";
import { sacramentoAdapter, getDiscoveredAreasSacramento } from "./adapters/sacramento-arcgis.js";
import { atlantaAdapter, getDiscoveredAreasAtlanta } from "./adapters/atlanta-arcgis.js";
import { indianapolisAdapter, getDiscoveredAreasIndianapolis } from "./adapters/indianapolis-arcgis.js";
import { raleighAdapter, getDiscoveredAreasRaleigh } from "./adapters/raleigh-arcgis.js";
import { tucsonAdapter, getDiscoveredAreasTucson } from "./adapters/tucson-arcgis.js";
import { honoluluAdapter, getDiscoveredAreasHonolulu } from "./adapters/honolulu-socrata.js";
import { longBeachAdapter, getDiscoveredAreasLongBeach } from "./adapters/long-beach-arcgis.js";

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
    // Baltimore, MD — BPD "NIBRS Group A Crime Data" ArcGIS FeatureServer.
    // Incident-level rows that carry an official Baltimore Neighborhood name
    // (283 of them) plus lat/lng; grouped by the feed's own neighborhood field
    // with centroids derived from incident coordinates. Replaced Nashville.
    slug: "baltimore",
    label: "Baltimore",
    bbox: { south: 39.197, west: -76.711, north: 39.372, east: -76.529 },
    adapter: baltimoreAdapter,
    discover: getDiscoveredAreasBaltimore,
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
    // Fort Worth, TX — FWPD "Crime Data" ArcGIS MapServer. Incident-level rows
    // with lat/lng that carry an FWPD patrol Beat (~102 beats); grouped by the
    // feed's own Beat field with centroids from incident coordinates. Offenses
    // are Texas Penal Code text mapped to FBI Part-1 by PC section. Replaced
    // Phoenix (upstream feed froze 2025-12-24).
    slug: "fort-worth",
    label: "Fort Worth",
    bbox: { south: 32.55, west: -97.54, north: 32.96, east: -97.03 },
    adapter: fortWorthAdapter,
    discover: getDiscoveredAreasFortWorth,
  },
  {
    // v70 — Denver re-enabled. Upstream auth gate that blocked us in
    // May 2026 was lifted by 2026-05-25; ODC_CRIME_OFFENSES_P now
    // serves anonymous requests again. Appended at the END of CITIES
    // (not inserted at the original CITIES[6] slot it would have
    // had) because `cityForArea` uses hardcoded indices — inserting
    // mid-list would shift every subsequent index.
    slug: "denver",
    label: "Denver",
    bbox: { south: 39.61, west: -105.11, north: 39.91, east: -104.60 },
    adapter: denverAdapter,
    discover: getDiscoveredAreasDenver,
  },
  // v90 — 5 new cities (Honolulu deferred — Socrata HPD feed has no
  // lat/lng or neighborhood column). Tucson substituted as the
  // confirmed-fresh AZ candidate with full NEIGHBORHD + LAT/LONG.
  {
    slug: "sacramento",
    label: "Sacramento",
    bbox: { south: 38.437, west: -121.560, north: 38.685, east: -121.362 },
    adapter: sacramentoAdapter,
    discover: getDiscoveredAreasSacramento,
  },
  // v90p11 — Atlanta RE-ENABLED. Adapter now points at the real
  // APD-administered OpenDataWebsite_Crime_view on services3.arcgis.com
  // (owner RJStanionis0638 = official Atlanta Police Open Data Hub admin).
  // 243k records, fresh through 2026-05-25, with lat/lng + NhoodName.
  // The earlier "Crimes_public_..." dataset our scout misidentified was
  // actually Asheville NC data.
  {
    slug: "atlanta",
    label: "Atlanta",
    bbox: { south: 33.647, west: -84.551, north: 33.887, east: -84.290 },
    adapter: atlantaAdapter,
    discover: getDiscoveredAreasAtlanta,
  },
  {
    slug: "indianapolis",
    label: "Indianapolis",
    bbox: { south: 39.632, west: -86.329, north: 39.928, east: -85.937 },
    adapter: indianapolisAdapter,
    discover: getDiscoveredAreasIndianapolis,
  },
  {
    slug: "raleigh",
    label: "Raleigh",
    bbox: { south: 35.667, west: -78.792, north: 35.927, east: -78.510 },
    adapter: raleighAdapter,
    discover: getDiscoveredAreasRaleigh,
  },
  {
    slug: "tucson",
    label: "Tucson",
    bbox: { south: 32.083, west: -111.114, north: 32.318, east: -110.738 },
    adapter: tucsonAdapter,
    discover: getDiscoveredAreasTucson,
  },
  {
    // Honolulu — 37th city. Citywide-MVP: HPD's open-data feed
    // publishes blockaddress + offense type but no lat/lng or
    // neighborhood. Every incident lands in one citywide bucket
    // until per-neighborhood geocoding lands.
    slug: "honolulu",
    label: "Honolulu",
    bbox: { south: 21.245, west: -158.290, north: 21.711, east: -157.648 },
    adapter: honoluluAdapter,
    discover: getDiscoveredAreasHonolulu,
  },
  {
    // Long Beach, CA — 38th city. LBPD "Police Crime Mapping" ArcGIS
    // FeatureServer; incident-level NIBRS rows with point geometry,
    // geocoded to 98 official Long Beach neighborhoods via point-in-polygon.
    slug: "long-beach",
    label: "Long Beach",
    bbox: { south: 33.733, west: -118.249, north: 33.885, east: -118.063 },
    adapter: longBeachAdapter,
    discover: getDiscoveredAreasLongBeach,
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

// v99 — San Diego is the default city (CITIES[0]) and uses name-derived,
// UNPREFIXED slugs. A handful of real SD neighborhood names begin with
// another city's routing prefix, so the greedy startsWith() checks below
// misrouted them to the wrong adapter — e.g. "La Jolla"/"La Playa" matched
// "la-" (Los Angeles) and "Oak Park" matched "oak-" (Oakland), producing
// 500s ("Unknown area slug … not found in Los Angeles adapter") and
// wrong-city safety scores. These slugs are unambiguously San Diego's, so
// pin them before prefix matching. Keep in sync if SD adds a neighborhood
// whose slug collides with a prefix in the table below.
const SAN_DIEGO_SLUG_OVERRIDES: ReadonlySet<string> = new Set([
  "la-jolla",
  "la-playa",
  "oak-park",
]);

/// Route an area slug to its city. Slugs are prefixed by adapter
/// (la-*, sf-*, chi-*); bare slugs default to San Diego.
export function cityForArea(slug: string): CityEntry {
  if (SAN_DIEGO_SLUG_OVERRIDES.has(slug)) return CITIES[0];
  if (slug.startsWith("la-")  || slug === "los-angeles")   return CITIES[1];
  if (slug.startsWith("sf-")  || slug === "san-francisco") return CITIES[2];
  if (slug.startsWith("chi-") || slug === "chicago")       return CITIES[3];
  if (slug.startsWith("sea-") || slug === "seattle")       return CITIES[4];
  if (slug.startsWith("ny-")  || slug === "new-york")      return CITIES[5];
  if (slug.startsWith("cosp-") || slug === "colorado-springs") return CITIES[6];
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
  if (slug.startsWith("balt-") || slug === "baltimore")    return CITIES[18];
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
  if (slug.startsWith("fw-")   || slug === "fort-worth")   return CITIES[29];
  if (slug.startsWith("den-")  || slug === "denver")       return CITIES[30];
  if (slug.startsWith("sac-")  || slug === "sacramento")   return CITIES[31];
  if (slug.startsWith("atl-")  || slug === "atlanta")      return CITIES[32];
  if (slug.startsWith("indy-") || slug === "indianapolis") return CITIES[33];
  if (slug.startsWith("rdu-")  || slug === "raleigh")      return CITIES[34];
  if (slug.startsWith("tuc-")  || slug === "tucson")       return CITIES[35];
  if (slug.startsWith("hnl-")  || slug === "honolulu")     return CITIES[36];
  if (slug.startsWith("lb-")   || slug === "long-beach")   return CITIES[37];
  return CITIES[0];
}

export function cityBySlug(slug: string): CityEntry | null {
  return CITIES.find((c) => c.slug === slug) ?? null;
}
