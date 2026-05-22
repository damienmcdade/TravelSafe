import "server-only";
import type { CrimeDataAdapter } from "./types";
import type { KnownArea } from "./neighborhoods";
import { sdpdNibrsAdapter, getDiscoveredAreas as getDiscoveredAreasSD } from "./adapters/sdpd-nibrs";
import { lapdAdapter, getDiscoveredAreasLA } from "./adapters/lapd-socrata";
import { sfAdapter, getDiscoveredAreasSF } from "./adapters/sf-socrata";
import { chicagoAdapter, getDiscoveredAreasChicago } from "./adapters/chicago-socrata";
import { seattleAdapter, getDiscoveredAreasSeattle } from "./adapters/seattle-socrata";
import { nypdAdapter, getDiscoveredAreasNYC } from "./adapters/nypd-socrata";
import { denverAdapter, getDiscoveredAreasDenver } from "./adapters/denver-arcgis";
import { detroitAdapter, getDiscoveredAreasDetroit } from "./adapters/detroit-arcgis";
import { dcAdapter, getDiscoveredAreasDC } from "./adapters/dc-arcgis";
import { bostonAdapter, getDiscoveredAreasBoston } from "./adapters/boston-ckan";

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
    slug: "denver",
    label: "Denver",
    bbox: { south: 39.61, west: -105.11, north: 39.91, east: -104.60 },
    adapter: denverAdapter,
    discover: getDiscoveredAreasDenver,
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
];

export function cityFromLatLng(point: { lat: number; lng: number }): CityEntry | null {
  for (const c of CITIES) {
    if (point.lat >= c.bbox.south && point.lat <= c.bbox.north && point.lng >= c.bbox.west && point.lng <= c.bbox.east) {
      return c;
    }
  }
  return null;
}

/// Route an area slug to its city. Slugs are prefixed by adapter
/// (la-*, sf-*, chi-*); bare slugs default to San Diego.
export function cityForArea(slug: string): CityEntry {
  if (slug.startsWith("la-")  || slug === "los-angeles")   return CITIES[1];
  if (slug.startsWith("sf-")  || slug === "san-francisco") return CITIES[2];
  if (slug.startsWith("chi-") || slug === "chicago")       return CITIES[3];
  if (slug.startsWith("sea-") || slug === "seattle")       return CITIES[4];
  if (slug.startsWith("ny-")  || slug === "new-york")      return CITIES[5];
  if (slug.startsWith("den-") || slug === "denver")        return CITIES[6];
  if (slug.startsWith("det-") || slug === "detroit")       return CITIES[7];
  if (slug.startsWith("dc-")  || slug === "washington-dc") return CITIES[8];
  if (slug.startsWith("bos-") || slug === "boston")        return CITIES[9];
  return CITIES[0];
}

export function cityBySlug(slug: string): CityEntry | null {
  return CITIES.find((c) => c.slug === slug) ?? null;
}
