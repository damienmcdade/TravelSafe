import "server-only";
import type { CrimeDataAdapter } from "./types";
import type { KnownArea } from "./neighborhoods";
import { sdpdNibrsAdapter, getDiscoveredAreas as getDiscoveredAreasSD } from "./adapters/sdpd-nibrs";
import { lapdAdapter, getDiscoveredAreasLA } from "./adapters/lapd-socrata";
import { sfAdapter, getDiscoveredAreasSF } from "./adapters/sf-socrata";
import { oaklandAdapter, getDiscoveredAreasOakland } from "./adapters/oakland-socrata";
import { createCityStub } from "./adapters/stub-city";

// City registry. Each city pairs a bounding box (for lat/lng -> city detection)
// with its incident adapter and its discovery function. Adding a new city is
// a single entry here + one adapter file. See adapters/lapd-socrata.ts and
// adapters/sf-socrata.ts for full examples; adapters/stub-city.ts for the
// "no public API yet" pattern.

export interface CityEntry {
  slug: string;
  label: string;
  bbox: { south: number; west: number; north: number; east: number };
  adapter: CrimeDataAdapter;
  discover: () => Promise<KnownArea[]>;
}

const longBeachStub = createCityStub("Long Beach", { lat: 33.770, lng: -118.193 });
const sanJoseStub   = createCityStub("San Jose",   { lat: 37.336, lng: -121.890 });

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
    slug: "oakland",
    label: "Oakland",
    bbox: { south: 37.69, west: -122.36, north: 37.89, east: -122.11 },
    adapter: oaklandAdapter,
    discover: getDiscoveredAreasOakland,
  },
  {
    slug: "long-beach",
    label: "Long Beach",
    bbox: { south: 33.72, west: -118.27, north: 33.89, east: -118.07 },
    adapter: longBeachStub.adapter,
    discover: longBeachStub.discover,
  },
  {
    slug: "san-jose",
    label: "San Jose",
    bbox: { south: 37.15, west: -122.05, north: 37.47, east: -121.75 },
    adapter: sanJoseStub.adapter,
    discover: sanJoseStub.discover,
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

/// Route an area slug to the city that owns it. Slugs are prefixed by adapter
/// (la-*, sf-*, oak-*, etc.) — bare slugs default to San Diego.
export function cityForArea(slug: string): CityEntry {
  if (slug.startsWith("la-")  || slug === "los-angeles")   return CITIES[1];
  if (slug.startsWith("sf-")  || slug === "san-francisco") return CITIES[2];
  if (slug.startsWith("oak-") || slug === "oakland")       return CITIES[3];
  if (slug.startsWith("long-beach-") || slug === "long-beach") return CITIES[4];
  if (slug.startsWith("san-jose-") || slug === "san-jose") return CITIES[5];
  return CITIES[0];
}

export function cityBySlug(slug: string): CityEntry | null {
  return CITIES.find((c) => c.slug === slug) ?? null;
}
