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
  { slug: "san-diego",     label: "San Diego",     state: "CA", stateLabel: "California", defaultArea: "san-diego",     centroid: { lat: 32.78, lng: -117.18 }, status: "live",         source: "SDPD NIBRS Crime Offenses · data.sandiego.gov" },
  { slug: "los-angeles",   label: "Los Angeles",   state: "CA", stateLabel: "California", defaultArea: "la-hollywood",  centroid: { lat: 34.05, lng: -118.32 }, status: "live",         source: "LAPD Crime Data 2020-Present · data.lacity.org" },
  { slug: "san-francisco", label: "San Francisco", state: "CA", stateLabel: "California", defaultArea: "sf-mission",    centroid: { lat: 37.76, lng: -122.44 }, status: "live",         source: "SFPD Incident Reports · data.sfgov.org" },
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
