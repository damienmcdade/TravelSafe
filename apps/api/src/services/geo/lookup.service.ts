import { SD_AREAS, findArea, nearestArea, type KnownArea } from "../crime-data/neighborhoods.js";
import { CITIES, cityBySlug } from "@travelsafe/crime-data/cities";

// v95p22 — when citySlug is supplied, snap-to-nearest runs against
// THAT city's discovered neighborhoods, not the SD-only static
// SD_AREAS. Pre-v95p22 a NYC geocode that successfully resolved
// "Times Square" → 40.76,-73.99 then fell back to SD_AREAS for the
// snap, which (correctly) rejected the point as >20km from the
// nearest SD area → no_match. With per-city discovery the same
// flow snaps Times Square into NYPD's 14th Precinct.
async function nearestAreaForCity(point: { lat: number; lng: number }, citySlug: string | undefined): Promise<KnownArea | null> {
  if (!citySlug) return nearestArea(point);
  const city = cityBySlug(citySlug);
  if (!city) {
    console.warn(`[geo/lookup] no city for slug=${citySlug}, falling back to SD nearestArea`);
    return nearestArea(point);
  }
  try {
    const areas = await city.discover();
    if (areas.length === 0) {
      console.warn(`[geo/lookup] city=${citySlug} discover returned 0 areas`);
      return nearestArea(point);
    }
    const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
    let best: { area: KnownArea; km: number } | null = null;
    for (const area of areas) {
      const dLat = toRad(area.centroid.lat - point.lat);
      const dLng = toRad(area.centroid.lng - point.lng);
      const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(point.lat)) * Math.cos(toRad(area.centroid.lat)) * Math.sin(dLng / 2) ** 2;
      const km = 2 * R * Math.asin(Math.sqrt(s));
      if (!best || km < best.km) best = { area, km };
    }
    if (best) {
      console.log(`[geo/lookup] city=${citySlug} nearest=${best.area.slug} (${best.km.toFixed(1)}km)`);
    }
    return best && best.km < 60 ? best.area : null;
  } catch (err) {
    console.warn(`[geo/lookup] city=${citySlug} discover threw:`, (err as Error).message);
    return nearestArea(point);
  }
}

// Layered location lookup for any tracked city.
//   1) exact slug / name match
//   2) ZIP-code lookup against a small in-repo SD ZIP table OR Nominatim
//   3) Nominatim (OpenStreetMap) geocode -> nearest known neighborhood centroid
// Anything that can't resolve to a known neighborhood returns null;
// callers then fall back to the citywide aggregate.

// v95p15 — per-city Nominatim scoping. Same fix as the Vercel-side
// lookup.ts (apps/web). Pre-v95p15 this hardcoded "San Diego" into
// every Nominatim query, breaking address matches outside SD.
interface CityHint { label: string; bbox: { south: number; west: number; north: number; east: number } }
const CITY_HINT_BY_SLUG = new Map<string, CityHint>(
  CITIES.map((c) => [c.slug, { label: c.label, bbox: c.bbox }]),
);

const SD_ZIP_TO_AREA: Record<string, string> = {
  "92101": "downtown-sd",
  "92103": "hillcrest",
  "92104": "north-park",
  "92108": "mission-valley",
  "92109": "pacific-beach",
  "92037": "la-jolla",
  "92126": "mira-mesa",
  "92121": "mira-mesa",
  "92123": "mission-valley",
};

export interface LookupResult {
  area: KnownArea;
  matchedVia: "exact" | "zip" | "fuzzy" | "geocode";
  rawQuery: string;
}

function fuzzyMatch(needle: string): KnownArea | null {
  const n = needle.toLowerCase().replace(/[^a-z0-9 ]+/g, "");
  if (!n) return null;
  const tokens = n.split(/\s+/).filter(Boolean);
  let best: { area: KnownArea; score: number } | null = null;
  for (const area of SD_AREAS) {
    const hay = `${area.slug} ${area.label}`.toLowerCase();
    let score = 0;
    for (const t of tokens) if (hay.includes(t)) score += t.length;
    if (score > 0 && (!best || score > best.score)) best = { area, score };
  }
  return best?.area ?? null;
}

async function nominatimGeocode(query: string, citySlug?: string): Promise<{ lat: number; lng: number } | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  const hint = citySlug ? CITY_HINT_BY_SLUG.get(citySlug) : undefined;
  const q = hint ? `${query}, ${hint.label}` : `${query}, San Diego, California`;
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  if (hint) {
    url.searchParams.set("viewbox", `${hint.bbox.west},${hint.bbox.north},${hint.bbox.east},${hint.bbox.south}`);
  } else {
    url.searchParams.set("viewbox", "-117.6,33.5,-116.0,32.5");
  }
  url.searchParams.set("bounded", "1");
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "TravelSafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!arr.length) return null;
    return { lat: Number(arr[0].lat), lng: Number(arr[0].lon) };
  } catch {
    return null;
  }
}

export async function lookupLocation(q: string, citySlug?: string): Promise<LookupResult | null> {
  const trimmed = q.trim();
  if (!trimmed) return null;

  const exact = findArea(trimmed);
  if (exact) return { area: exact, matchedVia: "exact", rawQuery: trimmed };

  const zipMatch = trimmed.match(/\b(9\d{4})\b/);
  if (zipMatch && SD_ZIP_TO_AREA[zipMatch[1]]) {
    const area = findArea(SD_ZIP_TO_AREA[zipMatch[1]]);
    if (area) return { area, matchedVia: "zip", rawQuery: trimmed };
  }

  // v95p15 — geocode-first when query has comma OR 3+ words (likely a
  // real address/landmark). Pre-v95p15 the fuzzy match always ran first
  // and routinely mis-matched ("Balboa Park" → "North Park" because
  // both contain "park"). Same fix mirrored from apps/web lookup.ts.
  const hasComma = trimmed.includes(",");
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (hasComma || wordCount >= 3) {
    const geo = await nominatimGeocode(trimmed, citySlug);
    if (geo) {
      const area = await nearestAreaForCity(geo, citySlug);
      if (area) return { area, matchedVia: "geocode", rawQuery: trimmed };
    }
  }

  const fuzzy = fuzzyMatch(trimmed);
  if (fuzzy) return { area: fuzzy, matchedVia: "fuzzy", rawQuery: trimmed };

  const geo = await nominatimGeocode(trimmed, citySlug);
  if (geo) {
    const area = await nearestAreaForCity(geo, citySlug);
    if (area) return { area, matchedVia: "geocode", rawQuery: trimmed };
  }
  return null;
}

export function allKnownAreas(): KnownArea[] {
  return SD_AREAS;
}
