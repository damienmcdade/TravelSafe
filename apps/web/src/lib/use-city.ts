"use client";
import { useCallback, useSyncExternalStore } from "react";

export interface CityInfo {
  slug: string;
  label: string;
  /// Default jurisdiction slug used for citywide views when no specific area
  /// is selected.
  defaultArea: string;
  /// Map centroid for re-centering the Crime Map.
  centroid: { lat: number; lng: number };
  /// USPS state abbreviation (e.g. "CA"). Used by the state/city wheel
  /// selectors to group cities and to filter the city wheel by state.
  state: string;
  /// Full state name shown in the state wheel.
  stateLabel: string;
  /// Whether the city's data feed is wired up. Cities that are listed as
  /// "coming soon" can render in the wheel as disabled so users see what's
  /// on the roadmap, but don't select something that has no data.
  status: "live" | "coming-soon";
  /// Short description of the official source powering the city.
  source?: string;
}

// Only cities with verified, current public crime APIs go in as "live".
// "coming-soon" entries are stubs in the registry so the wheel selector can
// surface roadmap cities without breaking anything when picked. They render
// greyed-out and the wheel refuses to land on them.
export const CITIES: CityInfo[] = [
  // California — all live
  { slug: "san-diego",     label: "San Diego",     state: "CA", stateLabel: "California", defaultArea: "san-diego",     centroid: { lat: 32.78,  lng: -117.18 }, status: "live", source: "SDPD NIBRS Crime Offenses · data.sandiego.gov" },
  { slug: "los-angeles",   label: "Los Angeles",   state: "CA", stateLabel: "California", defaultArea: "la-hollywood",  centroid: { lat: 34.05,  lng: -118.32 }, status: "live", source: "LAPD Crime Data 2020-Present · data.lacity.org" },
  { slug: "san-francisco", label: "San Francisco", state: "CA", stateLabel: "California", defaultArea: "sf-mission",    centroid: { lat: 37.76,  lng: -122.44 }, status: "live", source: "SFPD Incident Reports · data.sfgov.org" },
  // Illinois — Chicago is the 4th live city.
  { slug: "chicago",       label: "Chicago",       state: "IL", stateLabel: "Illinois",   defaultArea: "chi-loop",      centroid: { lat: 41.88,  lng: -87.63  }, status: "live", source: "Chicago Crimes 2001-Present · data.cityofchicago.org" },
  // Coming-soon roadmap. These entries surface the destination cities in the
  // state/city wheel (greyed-out) so users see where CommunitySafe is heading.
  // When each adapter lands they flip to status: "live".
  { slug: "new-york",      label: "New York City", state: "NY", stateLabel: "New York",       defaultArea: "ny-1st-precinct", centroid: { lat: 40.71, lng: -74.01 }, status: "live",        source: "NYPD Complaint Data · data.cityofnewyork.us" },
  { slug: "seattle",       label: "Seattle",       state: "WA", stateLabel: "Washington",     defaultArea: "sea-downtown",   centroid: { lat: 47.61,  lng: -122.33 }, status: "live",        source: "SPD Crime Data · data.seattle.gov" },
  // Boston serves bundled snapshot data (refreshed via tools/refresh-boston.mjs)
  // because data.boston.gov rejects Vercel's IP range for non-trivial pulls.
  // If BOSTON_PROXY_URL is set (Cloudflare Worker deployed), the adapter
  // prefers the live feed; otherwise it serves the snapshot.
  { slug: "boston",        label: "Boston",        state: "MA", stateLabel: "Massachusetts",  defaultArea: "bos-a1",         centroid: { lat: 42.36,  lng: -71.06  }, status: "live",        source: "BPD Crime Incident Reports · data.boston.gov (bundled snapshot)" },
  { slug: "philadelphia",  label: "Philadelphia",  state: "PA", stateLabel: "Pennsylvania",   defaultArea: "phl-9",          centroid: { lat: 39.95,  lng: -75.17  }, status: "live",        source: "PPD Crime Incidents · phl.carto.com (CARTO SQL)" },
  { slug: "oakland",       label: "Oakland",       state: "CA", stateLabel: "California",     defaultArea: "oak-coliseum",   centroid: { lat: 37.80,  lng: -122.27 }, status: "live",        source: "OPD CrimeWatch Reports · data.oaklandca.gov" },
  { slug: "cincinnati",    label: "Cincinnati",    state: "OH", stateLabel: "Ohio",           defaultArea: "cin-downtown",   centroid: { lat: 39.10,  lng: -84.51  }, status: "live",        source: "CPD Crime Incidents · data.cincinnati-oh.gov" },
  { slug: "new-orleans",   label: "New Orleans",   state: "LA", stateLabel: "Louisiana",      defaultArea: "nola-french-quarter", centroid: { lat: 29.95, lng: -90.07 }, status: "live",        source: "NOPD Calls for Service 2026 · data.nola.gov" },
  { slug: "baton-rouge",   label: "Baton Rouge",   state: "LA", stateLabel: "Louisiana",      defaultArea: "br-old-south-baton-rouge", centroid: { lat: 30.44, lng: -91.13 }, status: "live",        source: "BRPD Crime Incidents · data.brla.gov" },
  { slug: "cambridge",     label: "Cambridge",     state: "MA", stateLabel: "Massachusetts",  defaultArea: "cam-cambridgeport", centroid: { lat: 42.375, lng: -71.105 }, status: "live",        source: "CPD Crime Reports · data.cambridgema.gov" },
  { slug: "dallas",        label: "Dallas",        state: "TX", stateLabel: "Texas",          defaultArea: "dal-downtown",     centroid: { lat: 32.78, lng: -96.80 }, status: "live",        source: "DPD Police Incidents · www.dallasopendata.com" },
  { slug: "charlotte",     label: "Charlotte",     state: "NC", stateLabel: "North Carolina", defaultArea: "clt-central",      centroid: { lat: 35.23, lng: -80.84 }, status: "live",        source: "CMPD Incidents · gis.charlottenc.gov (ArcGIS)" },
  { slug: "baltimore",     label: "Baltimore",     state: "MD", stateLabel: "Maryland",       defaultArea: "balt-downtown",    centroid: { lat: 39.29, lng: -76.61 }, status: "live",        source: "BPD NIBRS Group A Crime Data · data.baltimorecity.gov" },
  { slug: "minneapolis",   label: "Minneapolis",   state: "MN", stateLabel: "Minnesota",      defaultArea: "mpls-downtown-west",  centroid: { lat: 44.98, lng: -93.27 }, status: "live",        source: "MPD Crime_Data · opendata.minneapolismn.gov (ArcGIS)" },
  { slug: "cleveland",     label: "Cleveland",     state: "OH", stateLabel: "Ohio",           defaultArea: "cle-downtown",        centroid: { lat: 41.50, lng: -81.69 }, status: "live",        source: "CDP Calls for Service · opendata.clevelandohio.gov (ArcGIS)" },
  { slug: "milwaukee",         label: "Milwaukee",         state: "WI", stateLabel: "Wisconsin",  defaultArea: "milwaukee",          centroid: { lat: 43.0389, lng: -87.9065 }, status: "live",        source: "Milwaukee Police WIBR Crime Data · data.milwaukee.gov" },
  { slug: "las-vegas",     label: "Las Vegas",     state: "NV", stateLabel: "Nevada",         defaultArea: "lv-downtown",        centroid: { lat: 36.17, lng: -115.14 }, status: "live",        source: "LVMPD Calls for Service · Opendata Las Vegas (ArcGIS)" },
  { slug: "boise",         label: "Boise",         state: "ID", stateLabel: "Idaho",          defaultArea: "bzi-downtown-boise", centroid: { lat: 43.62, lng: -116.21 }, status: "live",        source: "BPD Calls for Service · opendata.cityofboise.org (ArcGIS)" },
  { slug: "buffalo",       label: "Buffalo",       state: "NY", stateLabel: "New York",       defaultArea: "buf-allentown",      centroid: { lat: 42.89, lng: -78.86 }, status: "live",        source: "BPD Crime Incidents · data.buffalony.gov" },
  { slug: "norfolk",       label: "Norfolk",       state: "VA", stateLabel: "Virginia",       defaultArea: "nor-downtown-norfolk-civic-league",  centroid: { lat: 36.85, lng: -76.28 }, status: "live",        source: "Norfolk Police Incident Reports · data.norfolk.gov (Socrata)" },
  { slug: "kansas-city",   label: "Kansas City",   state: "MO", stateLabel: "Missouri",       defaultArea: "kc-westport",        centroid: { lat: 39.10, lng: -94.58 }, status: "live",        source: "KCPD Crime Data 2026 · data.kcmo.org" },
  { slug: "saint-paul",    label: "Saint Paul",    state: "MN", stateLabel: "Minnesota",      defaultArea: "sp-downtown",        centroid: { lat: 44.95, lng: -93.10 }, status: "live",        source: "SPPD Crime Incident Report · information.stpaul.gov (ArcGIS)" },
  { slug: "pittsburgh",    label: "Pittsburgh",    state: "PA", stateLabel: "Pennsylvania",   defaultArea: "pgh-central-business-district", centroid: { lat: 40.44, lng: -79.99 }, status: "live",        source: "PBP Monthly Criminal Activity · WPRDC (CKAN)" },
  { slug: "washington-dc", label: "Washington",    state: "DC", stateLabel: "District of Columbia", defaultArea: "dc-downtown", centroid: { lat: 38.91, lng: -77.04 }, status: "live",        source: "DC MPD Crime Incidents (last 30 days) · opendata.dc.gov" },
  { slug: "colorado-springs", label: "Colorado Springs", state: "CO", stateLabel: "Colorado",     defaultArea: "cosp-gold-hill", centroid: { lat: 38.835, lng: -104.825 }, status: "live", source: "CSPD Crime Level Data · Colorado Springs Open Data (Socrata)" },
  { slug: "detroit",       label: "Detroit",       state: "MI", stateLabel: "Michigan",       defaultArea: "det-downtown",   centroid: { lat: 42.33,  lng: -83.05  }, status: "live",        source: "Detroit RMS Crime Incidents · Detroit Open Data (ArcGIS)" },
  // Fort Worth — FWPD Crime Data (City of Fort Worth GIS ArcGIS MapServer).
  // Incident-level rows grouped by FWPD patrol beat (~102 beats); Texas Penal
  // Code offenses mapped to FBI Part-1 by section. Replaced Phoenix.
  { slug: "fort-worth",    label: "Fort Worth",    state: "TX", stateLabel: "Texas",          defaultArea: "fw-arlington-heights", centroid: { lat: 32.73, lng: -97.32 }, status: "live",        source: "FWPD Crime Data · City of Fort Worth GIS" },
  // v90 — 5 cities added to backend but missed in this client-side
  // wheel-picker list until v95p5 (audit caught it: cities visible in
  // the API but not in the picker UI).
  { slug: "denver",        label: "Denver",        state: "CO", stateLabel: "Colorado",       defaultArea: "den-five-points",  centroid: { lat: 39.74, lng: -104.99 }, status: "live",        source: "DPD Crime Incidents · denvergov.org (ArcGIS)" },
  { slug: "sacramento",    label: "Sacramento",    state: "CA", stateLabel: "California",     defaultArea: "sac-midtown",      centroid: { lat: 38.58, lng: -121.49 }, status: "live",        source: "Sacramento PD Daily Crime · data.cityofsacramento.org (ArcGIS)" },
  { slug: "atlanta",       label: "Atlanta",       state: "GA", stateLabel: "Georgia",        defaultArea: "atl-midtown",      centroid: { lat: 33.75, lng: -84.39 }, status: "live",        source: "APD Crime Incidents · opendata.atlantapd.org (ArcGIS)" },
  { slug: "indianapolis",  label: "Indianapolis",  state: "IN", stateLabel: "Indiana",        defaultArea: "indy-downtown",    centroid: { lat: 39.77, lng: -86.16 }, status: "live",        source: "IMPD Crime Incidents · data.indy.gov (ArcGIS)" },
  // v110 — Raleigh + Tucson removed: their feeds expose only coarse police
  // districts / city-council wards (no neighborhood geography, no usable
  // coordinates to derive one), so they couldn't meet the recognizable-
  // neighborhood standard the rest of the fleet holds to. See cities.ts.
  // v95p1/v95p4 — Honolulu added as the 37th city. HPD's
  // data.honolulu.gov feed lacks lat/lng, so per-neighborhood comes
  // from a one-time OSM Nominatim geocode of every blockaddress.
  { slug: "honolulu",      label: "Honolulu",      state: "HI", stateLabel: "Hawaii",         defaultArea: "honolulu",         centroid: { lat: 21.31, lng: -157.86 }, status: "live",        source: "HPD Crime Incidents · data.honolulu.gov (Socrata)" },
  // v99 — Long Beach was added to the backend (38th city, 90 LBPD
  // neighborhoods) but was missing from this client wheel, so users
  // couldn't select it. Added here so the city + its neighborhoods are
  // reachable in the selector.
  { slug: "long-beach",    label: "Long Beach",    state: "CA", stateLabel: "California",     defaultArea: "lb-downtown",      centroid: { lat: 33.81, lng: -118.16 }, status: "live",        source: "LBPD NIBRS Incidents · CityofLB GIS (ArcGIS)" },
  // v110 — Austin removed: APD's public Crime Reports feed publishes no
  // lat/lng (only census block group / sector / district), so incidents
  // could only bucket into 10 coarse police sectors, not neighborhoods.
  { slug: "phoenix",       label: "Phoenix",       state: "AZ", stateLabel: "Arizona",        defaultArea: "phx-maryvale",     centroid: { lat: 33.4484, lng: -112.0740 }, status: "live", source: "Phoenix PD Crime Data · phoenixopendata.com (through Dec 2025)" },
  { slug: "jacksonville",  label: "Jacksonville",  state: "FL", stateLabel: "Florida",        defaultArea: "jax-downtown-jacksonville", centroid: { lat: 30.3322, lng: -81.6557 }, status: "live", source: "JSO NIBRS Incidents · Jacksonville Sheriff's Office (ArcGIS)" },
  { slug: "virginia-beach", label: "Virginia Beach", state: "VA", stateLabel: "Virginia",     defaultArea: "vb-aragona-village", centroid: { lat: 36.8529, lng: -76.0339 }, status: "live", source: "VBPD Police Incident Reports · data-vbgov.opendata.arcgis.com" },
  { slug: "gainesville",   label: "Gainesville",   state: "FL", stateLabel: "Florida",        defaultArea: "gnv-duval",        centroid: { lat: 29.6516, lng: -82.3248 }, status: "live", source: "GPD Crime Responses · data.cityofgainesville.org (Socrata)" },
  { slug: "tampa",         label: "Tampa",         state: "FL", stateLabel: "Florida",        defaultArea: "tpa-old-seminole-heights", centroid: { lat: 27.9506, lng: -82.4572 }, status: "live", source: "TPD Crimes (last 365 days) · City of Tampa GIS (ArcGIS)" },
  { slug: "nashville",     label: "Nashville",     state: "TN", stateLabel: "Tennessee",      defaultArea: "bna-east-nashville", centroid: { lat: 36.1627, lng: -86.7816 }, status: "live", source: "MNPD Incidents · Metro Nashville Open Data (ArcGIS); neighborhood boundaries © OpenStreetMap (ODbL)" },
  { slug: "houston",       label: "Houston",       state: "TX", stateLabel: "Texas",          defaultArea: "hou-montrose", centroid: { lat: 29.7604, lng: -95.3698 }, status: "live", source: "HPD NIBRS Crime (City of Houston Open Data, data through 2024); neighborhood boundaries © OpenStreetMap (ODbL)" },
  { slug: "montgomery-county", label: "Montgomery County", state: "MD", stateLabel: "Maryland", defaultArea: "moco-silver-spring", centroid: { lat: 39.1357, lng: -77.2014 }, status: "live", source: "Montgomery County PD Crime (Data Montgomery, Socrata); place boundaries © US Census Bureau TIGER/Line" },
  { slug: "prince-georges-county", label: "Prince George's County", state: "MD", stateLabel: "Maryland", defaultArea: "pg-bowie", centroid: { lat: 38.8290, lng: -76.8755 }, status: "live", source: "Prince George's County PD Reported Crime (PG Open Data, Socrata); place boundaries © US Census Bureau TIGER/Line" },
  // 2026-06 expansion — official neighborhood-level feeds, all live.
  { slug: "dayton",          label: "Dayton",          state: "OH", stateLabel: "Ohio",           defaultArea: "day-downtown",                          centroid: { lat: 39.76, lng: -84.19  }, status: "live", source: "Dayton PD NIBRS Incidents · City of Dayton ArcGIS" },
  { slug: "rochester",       label: "Rochester",       state: "NY", stateLabel: "New York",        defaultArea: "roc-central-business-district",         centroid: { lat: 43.16, lng: -77.61  }, status: "live", source: "Rochester PD Part I Crime · maps.cityofrochester.gov (ArcGIS)" },
  { slug: "raleigh",         label: "Raleigh",         state: "NC", stateLabel: "North Carolina",  defaultArea: "ral-central",                           centroid: { lat: 35.78, lng: -78.64  }, status: "live", source: "Raleigh PD Incidents · data.raleighnc.gov (ArcGIS)" },
  { slug: "grand-rapids",    label: "Grand Rapids",    state: "MI", stateLabel: "Michigan",        defaultArea: "grr-downtown",                          centroid: { lat: 42.96, lng: -85.67  }, status: "live", source: "Grand Rapids PD Incidents · City of Grand Rapids ArcGIS" },
  { slug: "riverside",       label: "Riverside",       state: "CA", stateLabel: "California",      defaultArea: "riv-downtown",                          centroid: { lat: 33.95, lng: -117.40 }, status: "live", source: "Riverside PD Crimes · City of Riverside ArcGIS" },
  { slug: "savannah",        label: "Savannah",        state: "GA", stateLabel: "Georgia",         defaultArea: "sav-abercon-strip",                     centroid: { lat: 32.08, lng: -81.09  }, status: "live", source: "Savannah PD Crimes · City of Savannah ArcGIS" },
  { slug: "corpus-christi",  label: "Corpus Christi",  state: "TX", stateLabel: "Texas",           defaultArea: "cc-downtown",                           centroid: { lat: 27.80, lng: -97.40  }, status: "live", source: "Corpus Christi PD Crime · cctexas.com (ArcGIS)" },
  { slug: "salt-lake-city",  label: "Salt Lake City",  state: "UT", stateLabel: "Utah",            defaultArea: "slc-central-9th-downtown-community",    centroid: { lat: 40.76, lng: -111.89 }, status: "live", source: "Salt Lake City PD Crime · maps.slc.gov (ArcGIS)" },
  { slug: "hartford",        label: "Hartford",        state: "CT", stateLabel: "Connecticut",     defaultArea: "htfd-downtown",                         centroid: { lat: 41.76, lng: -72.67  }, status: "live", source: "Hartford PD Incidents · City of Hartford ArcGIS" },
  { slug: "wichita",         label: "Wichita",         state: "KS", stateLabel: "Kansas",          defaultArea: "ict-downtown",                          centroid: { lat: 37.69, lng: -97.34  }, status: "live", source: "Wichita PD Crime · gismaps.wichita.gov (ArcGIS)" },
  { slug: "tucson",          label: "Tucson",          state: "AZ", stateLabel: "Arizona",         defaultArea: "tuc-downtown",                          centroid: { lat: 32.22, lng: -110.97 }, status: "live", source: "Tucson PD Incidents · gis.tucsonaz.gov (ArcGIS)" },
  { slug: "albuquerque",     label: "Albuquerque",     state: "NM", stateLabel: "New Mexico",      defaultArea: "abq-downtown-neighborhoods-association", centroid: { lat: 35.08, lng: -106.65 }, status: "live", source: "Albuquerque PD Incidents · cabq.gov (ArcGIS)" },
];

/// All US states with at least one CommunitySafe city, sorted alphabetically.
/// Computed from CITIES; do not edit by hand.
export const STATES: Array<{ abbr: string; label: string; cities: number }> = (() => {
  const m = new Map<string, { label: string; cities: number }>();
  for (const c of CITIES) {
    const cur = m.get(c.state) ?? { label: c.stateLabel, cities: 0 };
    cur.cities += 1;
    m.set(c.state, cur);
  }
  return Array.from(m.entries()).map(([abbr, v]) => ({ abbr, ...v })).sort((a, b) => a.label.localeCompare(b.label));
})();

const STORAGE_KEY = "travelsafe.city.v1";

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/// Current client snapshot: re-reads localStorage every call so a direct write
/// (e.g. a sibling page setting the city without going through setCity) is never
/// stale. Returns a referentially STABLE value — the element from CITIES (or the
/// CITIES[0] fallback) — so useSyncExternalStore doesn't loop.
function getSnapshot(): CityInfo {
  if (typeof window === "undefined") return CITIES[0];
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return CITIES.find((c) => c.slug === stored && c.status === "live") ?? CITIES[0];
}

/// SSR — and CRUCIALLY the first client (hydration) render — have no
/// localStorage, so both sides agree on CITIES[0]. useSyncExternalStore then
/// swaps in the stored city on the post-hydration commit. This mirrors
/// useArea's getServerSnapshot and is what fixes React #418: the previous
/// useState(() => load()) read localStorage during hydration, so a returning
/// user with any non-default city stored produced a server(San Diego) vs
/// client(stored city) text mismatch on every city + neighborhood page.
function getServerSnapshot(): CityInfo { return CITIES[0]; }

function persist(city: CityInfo) {
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(STORAGE_KEY, city.slug); } catch { /* quota — ignore */ }
  }
  for (const cb of listeners) cb();
}

/// React hook returning the currently-selected city + a setter. The choice
/// is persisted to localStorage and broadcasts to every other useCity()
/// consumer so the whole UI re-renders on a switch.
export function useCity() {
  const city = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setCity = useCallback((slug: string) => {
    const next = CITIES.find((c) => c.slug === slug && c.status === "live");
    if (next) persist(next);
  }, []);

  return { city, setCity, cities: CITIES };
}

export function citiesInState(stateAbbr: string): CityInfo[] {
  return CITIES.filter((c) => c.state === stateAbbr);
}
