"use client";
import { useCallback, useEffect, useState } from "react";

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
  // state/city wheel (greyed-out) so users see where TravelSafe is heading.
  // When each adapter lands they flip to status: "live".
  { slug: "new-york",      label: "New York City", state: "NY", stateLabel: "New York",       defaultArea: "ny-1st-precinct", centroid: { lat: 40.71, lng: -74.01 }, status: "live",        source: "NYPD Complaint Data · data.cityofnewyork.us" },
  { slug: "seattle",       label: "Seattle",       state: "WA", stateLabel: "Washington",     defaultArea: "sea-downtown",   centroid: { lat: 47.61,  lng: -122.33 }, status: "live",        source: "SPD Crime Data · data.seattle.gov" },
  { slug: "boston",        label: "Boston",        state: "MA", stateLabel: "Massachusetts",  defaultArea: "bos-a1",         centroid: { lat: 42.36,  lng: -71.06  }, status: "live",        source: "BPD Crime Incident Reports · data.boston.gov" },
  { slug: "philadelphia",  label: "Philadelphia",  state: "PA", stateLabel: "Pennsylvania",   defaultArea: "phl-9",          centroid: { lat: 39.95,  lng: -75.17  }, status: "live",        source: "PPD Crime Incidents · phl.carto.com (CARTO SQL)" },
  { slug: "washington-dc", label: "Washington",    state: "DC", stateLabel: "District of Columbia", defaultArea: "dc-cluster-8", centroid: { lat: 38.91, lng: -77.04 }, status: "live",        source: "DC MPD Crime Incidents (last 30 days) · opendata.dc.gov" },
  { slug: "denver",        label: "Denver",        state: "CO", stateLabel: "Colorado",       defaultArea: "den-five-points",centroid: { lat: 39.74,  lng: -104.99 }, status: "live",        source: "Denver Crime Offenses · Denver Open Data (ArcGIS)" },
  { slug: "detroit",       label: "Detroit",       state: "MI", stateLabel: "Michigan",       defaultArea: "det-downtown",   centroid: { lat: 42.33,  lng: -83.05  }, status: "live",        source: "Detroit RMS Crime Incidents · Detroit Open Data (ArcGIS)" },
];

/// All US states with at least one TravelSafe city, sorted alphabetically.
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

const listeners = new Set<(c: CityInfo) => void>();
let current: CityInfo | null = null;

function load(): CityInfo {
  if (current) return current;
  if (typeof window === "undefined") return CITIES[0];
  const stored = window.localStorage.getItem(STORAGE_KEY);
  const found = CITIES.find((c) => c.slug === stored && c.status === "live");
  current = found ?? CITIES[0];
  return current;
}

function save(city: CityInfo) {
  current = city;
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, city.slug);
  for (const cb of listeners) cb(city);
}

/// React hook returning the currently-selected city + a setter. The choice
/// is persisted to localStorage and broadcasts to every other useCity()
/// consumer so the whole UI re-renders on a switch.
export function useCity() {
  const [city, setCityState] = useState<CityInfo>(() => (typeof window === "undefined" ? CITIES[0] : load()));

  useEffect(() => {
    setCityState(load());
    const sub = (c: CityInfo) => setCityState(c);
    listeners.add(sub);
    return () => { listeners.delete(sub); };
  }, []);

  const setCity = useCallback((slug: string) => {
    const next = CITIES.find((c) => c.slug === slug && c.status === "live");
    if (next) save(next);
  }, []);

  return { city, setCity, cities: CITIES };
}

export function citiesInState(stateAbbr: string): CityInfo[] {
  return CITIES.filter((c) => c.state === stateAbbr);
}
