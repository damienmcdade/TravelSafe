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
import { honoluluAdapter, getDiscoveredAreasHonolulu } from "./adapters/honolulu-socrata.js";
import { longBeachAdapter, getDiscoveredAreasLongBeach } from "./adapters/long-beach-arcgis.js";
import { daytonAdapter, getDiscoveredAreasDayton } from "./adapters/dayton-arcgis.js";
import { rochesterAdapter, getDiscoveredAreasRochester } from "./adapters/rochester-arcgis.js";
import { raleighAdapter, getDiscoveredAreasRaleigh } from "./adapters/raleigh-arcgis.js";
import { grandRapidsAdapter, getDiscoveredAreasGrandRapids } from "./adapters/grand-rapids-arcgis.js";
import { riversideAdapter, getDiscoveredAreasRiverside } from "./adapters/riverside-arcgis.js";
import { savannahAdapter, getDiscoveredAreasSavannah } from "./adapters/savannah-arcgis.js";
import { corpusChristiAdapter, getDiscoveredAreasCorpusChristi } from "./adapters/corpus-christi-arcgis.js";
import { phoenixAdapter, getDiscoveredAreasPhoenix } from "./adapters/phoenix-ckan.js";
import { jacksonvilleAdapter, getDiscoveredAreasJacksonville } from "./adapters/jacksonville-arcgis.js";
import { virginiaBeachAdapter, getDiscoveredAreasVirginiaBeach, getPrimaryAreasVirginiaBeach } from "./adapters/virginia-beach-arcgis.js";
import { gainesvilleAdapter, getDiscoveredAreasGainesville } from "./adapters/gainesville-socrata.js";
import { tampaAdapter, getDiscoveredAreasTampa } from "./adapters/tampa-arcgis.js";
import { nashvilleAdapter, getDiscoveredAreasNashville } from "./adapters/nashville-arcgis.js";
import { houstonAdapter, getDiscoveredAreasHouston } from "./adapters/houston-arcgis.js";
import { montgomeryCountyAdapter, getDiscoveredAreasMontgomeryCounty } from "./adapters/montgomery-county-socrata.js";
import { princeGeorgesCountyAdapter, getDiscoveredAreasPrinceGeorgesCounty } from "./adapters/prince-georges-county-socrata.js";

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
  // FULL area list — drives the citywide aggregation (sum incidents per area), so
  // it must be complete. Never threshold this.
  discover: () => Promise<KnownArea[]>;
  // OPTIONAL display-only subset for the neighborhood picker + coverage "tracked"
  // count. Defaults to `discover` when unset. Set ONLY for cities whose feed over-
  // fragments into many micro-areas (e.g. Virginia Beach's 961 subdivisions) so the
  // UI shows real civic areas while the full list still feeds the grade. fix(audit
  // vb-over-fragmentation).
  discoverPrimary?: () => Promise<KnownArea[]>;
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
    // fix(audit coverage-dal-bbox-clip): widened to the official City of Dallas
    // city-limits extent (eGIS CityLimits layer, reprojected to WGS84: N 33.031,
    // S 32.606, E -96.463, W -97.001). The prior box clipped both the east edge
    // (-96.55 vs -96.463) and the west edge (-96.99 vs -97.001), dropping real
    // city territory from point-in-bbox routing.
    bbox: { south: 32.60, west: -97.01, north: 33.04, east: -96.45 },
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
    // (WIBR/NIBRS, ~100k rows, WGS84 coords) on data.milwaukee.gov, placed
    // into DCD neighborhoods by point-in-polygon.
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
    // Honolulu. HPD's open-data feed publishes a redacted
    // block-address + offense type but no neighborhood field; each incident
    // is geocoded offline to one of ~119 named Honolulu neighborhoods
    // (Waikiki, Kalihi, Ala Moana…) via the honolulu-socrata adapter's
    // blockaddress→neighborhood cache (data/honolulu-blockaddress-neighborhood.json).
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
  {
    // Phoenix, AZ. Re-added per request. The only official feed is
    // an annual ARCHIVAL snapshot (phoenixopendata CKAN) frozen at 2025-12-31,
    // ZIP-level only (no lat/lng, ~13% missing-ZIP → "Unmapped"). The adapter
    // provenance surfaces "data through Dec 2025" so the UI is honest about it.
    slug: "phoenix",
    label: "Phoenix",
    bbox: { south: 33.29, west: -112.32, north: 33.92, east: -111.93 },
    adapter: phoenixAdapter,
    discover: getDiscoveredAreasPhoenix,
  },
  {
    // Jacksonville, FL — 41st city. JSO "NIBRS Incidents" ArcGIS FeatureServer:
    // incident-level NIBRS points + ZipCode, grouped by ZIP (35 areas).
    slug: "jacksonville",
    label: "Jacksonville",
    bbox: { south: 30.10, west: -81.90, north: 30.58, east: -81.39 },
    adapter: jacksonvilleAdapter,
    discover: getDiscoveredAreasJacksonville,
  },
  {
    // Virginia Beach, VA — 42nd city. VBPD "Police Offense Reports" ArcGIS
    // (no lat/lng); bucketed by the pre-joined Subdivision name (333 mapped,
    // numeric/beat-code/blank → "Unmapped").
    slug: "virginia-beach",
    label: "Virginia Beach",
    bbox: { south: 36.68, west: -76.23, north: 36.94, east: -75.91 },
    adapter: virginiaBeachAdapter,
    discover: getDiscoveredAreasVirginiaBeach,
    // Show only the busiest ~real civic areas in the picker/coverage count; the
    // full 961-subdivision discover() still feeds the citywide grade.
    discoverPrimary: getPrimaryAreasVirginiaBeach,
  },
  {
    // Gainesville, FL — 43rd city. GPD "Crime Responses" Socrata (lat/lng +
    // free-text narrative); point-in-polygon to 12 GPD patrol zones.
    slug: "gainesville",
    label: "Gainesville",
    bbox: { south: 29.58, west: -82.45, north: 29.72, east: -82.20 },
    adapter: gainesvilleAdapter,
    discover: getDiscoveredAreasGainesville,
  },
  {
    // Tampa, FL — 44th city. TPD "crimes_public_365days" ArcGIS FeatureServer:
    // incident-level Group-A index offenses (points) + a pre-joined civic-
    // association neighborhood name (117 areas, 100% bind to a polygon).
    // Index-crime only (no society/drug offenses); date-only (no offense time).
    slug: "tampa",
    label: "Tampa",
    bbox: { south: 27.81, west: -82.62, north: 28.17, east: -82.27 },
    adapter: tampaAdapter,
    discover: getDiscoveredAreasTampa,
  },
  {
    // Nashville, TN (Metro Nashville-Davidson) — MNPD Incidents ArcGIS
    // FeatureServer with per-incident coords + NIBRS; geocoded to recognizable
    // named neighborhoods (OSM boundaries, ODbL) via point-in-polygon.
    slug: "nashville",
    label: "Nashville",
    bbox: { south: 35.97, west: -87.06, north: 36.41, east: -86.51 },
    adapter: nashvilleAdapter,
    discover: getDiscoveredAreasNashville,
  },
  {
    // Houston, TX — HPD NIBRS (City of Houston ArcGIS); per-incident lat/lng +
    // NIBRS class, geocoded to recognizable named neighborhoods via OSM
    // boundaries (ODbL). Complete-year file through 2024 (provenance is honest).
    slug: "houston",
    label: "Houston",
    bbox: { south: 29.52, west: -95.91, north: 30.11, east: -95.01 },
    adapter: houstonAdapter,
    discover: getDiscoveredAreasHouston,
  },
  {
    // Montgomery County, MD — Montgomery County PD "Crime" (Socrata icn6-v9z3);
    // per-incident lat/lng + NIBRS top-level class, placed into the county's
    // recognizable constituent communities (Silver Spring, Rockville, Bethesda,
    // Gaithersburg, Germantown…) via point-in-polygon over Census place boundaries.
    slug: "montgomery-county",
    label: "Montgomery County",
    bbox: { south: 38.93, west: -77.44, north: 39.31, east: -76.89 },
    adapter: montgomeryCountyAdapter,
    discover: getDiscoveredAreasMontgomeryCounty,
  },
  {
    // Prince George's County, MD — PGPD reported crime (Socrata xjru-idbe);
    // per-incident lat/lng + free-text offense type, placed into the county's
    // recognizable constituent communities (Bowie, College Park, Hyattsville,
    // Laurel, Greenbelt, Suitland…) via point-in-polygon over Census boundaries.
    slug: "prince-georges-county",
    label: "Prince George's County",
    bbox: { south: 38.54, west: -77.08, north: 39.13, east: -76.67 },
    adapter: princeGeorgesCountyAdapter,
    discover: getDiscoveredAreasPrinceGeorgesCounty,
  },
  {
    // Dayton, OH — DPD "Crimes Greater 2016" ArcGIS FeatureServer; incident-level
    // NIBRS rows with point geometry + the city's own ~50 neighborhood names
    // (Nhood) taken straight from the feed. Hour-of-day from CT1_HOUR.
    slug: "dayton",
    label: "Dayton",
    bbox: { south: 39.67, west: -84.34, north: 39.85, east: -84.12 },
    adapter: daytonAdapter,
    discover: getDiscoveredAreasDayton,
  },
  {
    // Rochester, NY — RPD Part I Crime ArcGIS FeatureServer; incident-level rows
    // grouped by the 4 RPD patrol Sections (Clinton/Genesee/Goodman/Lake).
    slug: "rochester",
    label: "Rochester",
    bbox: { south: 43.05, west: -77.74, north: 43.24, east: -77.49 },
    adapter: rochesterAdapter,
    discover: getDiscoveredAreasRochester,
  },
  {
    // Raleigh, NC — RPD Police Incidents ArcGIS FeatureServer; per-incident
    // lat/lng (null-island filtered) grouped by the 6 RPD police districts.
    slug: "raleigh",
    label: "Raleigh",
    bbox: { south: 35.69, west: -78.78, north: 35.94, east: -78.49 },
    adapter: raleighAdapter,
    discover: getDiscoveredAreasRaleigh,
  },
  {
    // Grand Rapids, MI — GRPD geocoded incidents ArcGIS FeatureServer; grouped
    // by the 5 GRPD service areas (Central/East/North/South/West).
    slug: "grand-rapids",
    label: "Grand Rapids",
    bbox: { south: 42.88, west: -85.75, north: 43.02, east: -85.58 },
    adapter: grandRapidsAdapter,
    discover: getDiscoveredAreasGrandRapids,
  },
  {
    // Riverside, CA — RPD Crimes ArcGIS FeatureServer; per-incident NIBRS rows
    // carrying their own COMMUNITY (28 official Riverside neighborhoods).
    slug: "riverside",
    label: "Riverside",
    bbox: { south: 33.86, west: -117.52, north: 34.02, east: -117.27 },
    adapter: riversideAdapter,
    discover: getDiscoveredAreasRiverside,
  },
  {
    // Savannah, GA — SPD Crimes ArcGIS; per-incident NIBRS with the city's own
    // neighborhood field. Feed lags ~3 months (graded on the freshest 12mo).
    slug: "savannah",
    label: "Savannah",
    bbox: { south: 31.96, west: -81.25, north: 32.18, east: -81.04 },
    adapter: savannahAdapter,
    discover: getDiscoveredAreasSavannah,
  },
  {
    // Corpus Christi, TX — CCPD crime dashboard ArcGIS MapServer; point geometry
    // geocoded via point-in-polygon into the 9 Area Development Plan districts.
    slug: "corpus-christi",
    label: "Corpus Christi",
    bbox: { south: 27.63, west: -97.55, north: 27.85, east: -97.27 },
    adapter: corpusChristiAdapter,
    discover: getDiscoveredAreasCorpusChristi,
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
  const sd = cityBySlug("san-diego") ?? CITIES[0];
  // SD uses UNPREFIXED, name-derived slugs, so SD neighborhoods whose name
  // collides with another city's prefix ("la-jolla", "oak-park") are routed
  // explicitly to San Diego first.
  if (SAN_DIEGO_SLUG_OVERRIDES.has(slug)) return sd;
  // Exact city slug ("boston", "los-angeles").
  const exact = cityBySlug(slug);
  if (exact) return exact;
  // Area-slug prefix → city, resolved by SLUG via cityBySlug (NOT a hardcoded
  // CITIES[n] index). AREA_SLUG_PREFIX is the single source of truth, so
  // adding or removing a city never shifts an index and can never silently
  // misroute another city's areas (the bug class that bit Denver + every
  // prior add/remove). Prefixes are mutually non-overlapping.
  for (const citySlug of Object.keys(AREA_SLUG_PREFIX)) {
    const prefix = AREA_SLUG_PREFIX[citySlug];
    if (prefix && slug.startsWith(prefix)) {
      const c = cityBySlug(citySlug);
      if (c) return c;
    }
  }
  return sd; // unprefixed San Diego neighborhoods
}

export function cityBySlug(slug: string): CityEntry | null {
  return CITIES.find((c) => c.slug === slug) ?? null;
}

// Routing prefix per city (mirrors the cityForArea chain). SD is "" because
// its neighborhood slugs are bare and its few prefixed overrides
// (la-jolla/oak-park) title-case correctly without stripping.
const AREA_SLUG_PREFIX: Record<string, string> = {
  "los-angeles": "la-", "san-francisco": "sf-", "chicago": "chi-", "seattle": "sea-",
  "new-york": "ny-", "colorado-springs": "cosp-", "detroit": "det-", "washington-dc": "dc-",
  "boston": "bos-", "philadelphia": "phl-", "oakland": "oak-", "cincinnati": "cin-",
  "new-orleans": "nola-", "baton-rouge": "br-", "cambridge": "cam-", "dallas": "dal-",
  "charlotte": "clt-", "baltimore": "balt-", "minneapolis": "mpls-", "cleveland": "cle-",
  "milwaukee": "mke-", "las-vegas": "lv-", "boise": "bzi-", "buffalo": "buf-", "norfolk": "nor-",
  "kansas-city": "kc-", "saint-paul": "sp-", "pittsburgh": "pgh-", "fort-worth": "fw-",
  "denver": "den-", "sacramento": "sac-", "atlanta": "atl-", "indianapolis": "indy-",
  "honolulu": "hnl-", "long-beach": "lb-",
  "phoenix": "phx-", "jacksonville": "jax-", "virginia-beach": "vb-", "gainesville": "gnv-",
  "tampa": "tpa-",
  "nashville": "bna-",
  "houston": "hou-",
  "montgomery-county": "moco-",
  "prince-georges-county": "pg-",
  "dayton": "day-",
  "rochester": "roc-",
  "raleigh": "ral-",
  "grand-rapids": "grr-",
  "riverside": "riv-",
  "savannah": "sav-",
  "corpus-christi": "cc-",
};

const COMPASS = new Set(["n", "s", "e", "w", "nw", "ne", "sw", "se"]);
function titleCaseToken(t: string): string {
  if (!t) return t;
  if (COMPASS.has(t)) return t.toUpperCase();
  if (/^\d+(st|nd|rd|th)?$/.test(t)) return t; // 13th, 42 — leave as-is
  return t[0].toUpperCase() + t.slice(1);
}

/// Best-effort human label for an area slug when a caller doesn't supply an
/// explicit &label= (AI brief, OG image, direct API hits, or a frontend that
/// only has the slug). Strips the city's routing prefix and title-cases, e.g.
/// "gnv-azalea-trails" -> "Azalea Trails", "oak-park" (SD) -> "Oak Park".
/// The canonical discovered-area label is still preferred where available.
export function humanizeArea(slug: string): string {
  const city = cityForArea(slug);
  if (slug === city.slug) return city.label;
  const prefix = AREA_SLUG_PREFIX[city.slug] ?? "";
  const core = prefix && slug.startsWith(prefix) ? slug.slice(prefix.length) : slug;
  const label = core.split("-").map(titleCaseToken).join(" ").trim();
  return label || city.label;
}

// Acronyms / initialisms that must stay upper-case inside an otherwise
// title-cased neighborhood label. Kept deliberately small — only entries
// that genuinely read wrong title-cased. (Compass points handled separately.)
const LABEL_ACRONYMS = new Set([
  "NE", "NW", "SE", "SW", "II", "III", "IV", "USA", "BID", "TOD",
  "CSULB", "UCLA", "USC", "LSU", "SMU", "TCU", "VCU", "FSU", "UNO",
  // Recognizable place/facility codes that read correctly in uppercase rather
  // than title-cased ("DIA" not "Dia"). These are how locals refer to them.
  "DIA", "UMC", "CBD", "CSX", "PV",
]);
// Connector words that read better lower-case when not the first token.
const LABEL_SMALL_WORDS = new Set([
  "of", "the", "and", "on", "in", "at", "to", "by", "for",
  "de", "del", "la", "las", "los", "el", "von", "van",
]);

// Capitalize the first letter of every alphabetic run in a token so
// apostrophes/periods inside an upper-case token title-case correctly
// ("O'FALLON" -> "O'Fallon", "ST.LOUIS" -> "St.Louis").
function capitalizeRuns(lower: string): string {
  return lower.replace(/(^|[^a-z])([a-z])/g, (_m, pre, ch) => pre + ch.toUpperCase());
}

/// Normalize a DISPLAY label to clean Title Case with tidy spacing.
///
/// Most adapters publish proper-case neighborhood names, but a few open-data
/// feeds (Baltimore BPD, plus stray Baton Rouge / Long Beach / Tampa rows)
/// ship them SCREAMING IN ALL CAPS — "ABELL", "BELAIR-EDISON" — which then
/// rendered verbatim in the wheel, the Neighborhood Watch header, and every
/// card. This is the single choke point that fixes them fleet-wide.
///
/// Safety contract: if the label already contains ANY lower-case letter we
/// assume the casing is intentional ("Linda Vista", "North (Sector A)",
/// "McNeil") and only collapse runaway whitespace — never re-case it. So this
/// is idempotent and cannot damage a correctly-cased label. Only all-caps
/// labels are title-cased, token by token, preserving hyphens and slashes.
export function normalizeAreaLabel(label: string): string {
  if (!label) return label;
  // Tidy stray punctuation that applies regardless of casing: some feeds use a
  // backtick where an apostrophe belongs ("Brigand`s Quay" -> "Brigand's Quay").
  // Labels never legitimately contain a backtick, so this is always safe.
  const trimmed = label.replace(/`/g, "'").replace(/\s+/g, " ").trim();
  // Already has lower-case → trust upstream casing, just tidy punctuation/spacing.
  if (/[a-z]/.test(trimmed)) return trimmed;
  // Collapse a run of single capital letters separated by spaces into one
  // acronym ("L S U" → "LSU"); only when the WHOLE label is initials, so
  // "J F K Heights" is left alone (it has a lower-case word and returns above).
  if (/^([A-Z] ){1,4}[A-Z]$/.test(trimmed)) return trimmed.replace(/ /g, "");
  const words = trimmed.split(" ");
  return words
    .map((word, wi) =>
      word
        .split(/([/-])/)
        .map((part, pi) => {
          if (part === "" || part === "-" || part === "/") return part;
          if (LABEL_ACRONYMS.has(part)) return part;
          if (/^\d+(ST|ND|RD|TH)$/.test(part)) return part.toLowerCase(); // "13TH" -> "13th"
          if (/^\d+$/.test(part)) return part;
          const lower = part.toLowerCase();
          const isFirstToken = wi === 0 && pi === 0;
          if (!isFirstToken && LABEL_SMALL_WORDS.has(lower)) return lower;
          return capitalizeRuns(lower);
        })
        .join(""),
    )
    .join(" ");
}
