import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

/// Compute approximate polygon areas in km² for every neighborhood in a
/// city. Reads the same /public/geo/<city>.geojson files that the
/// CrimeMap renders, projects each ring with a local equirectangular
/// scale anchored to the polygon's mean latitude, and applies the
/// shoelace formula. Accurate to within a few percent for typical
/// neighborhood-scale polygons (5-50 km²) — close enough that using
/// area × density as a population proxy beats the cityPop/N_areas
/// peer-share when neighborhoods are very uneven in size (e.g. a small
/// downtown core vs a sprawling suburban district).
///
/// Returns a map keyed by polygon `properties.name`. Empty map when the
/// city has no polygon file or the file fails to parse — callers should
/// fall back to the peer-share denominator in that case.

type GeoRing = number[][];
type GeoFeature = {
  properties?: { name?: string } | null;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: GeoRing[] | GeoRing[][];
  };
};
type GeoCollection = { features: GeoFeature[] };

const cache = new Map<string, Map<string, number>>();

const KM_PER_DEG_LAT = 110.574;

function polygonAreaSqKm(rings: GeoRing[]): number {
  let totalLat = 0;
  let count = 0;
  for (const ring of rings) {
    for (const point of ring) {
      totalLat += point[1];
      count++;
    }
  }
  if (count === 0) return 0;
  const meanLat = totalLat / count;
  const latRad = (meanLat * Math.PI) / 180;
  const kmPerDegLon = 111.320 * Math.cos(latRad);

  let total = 0;
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    if (ring.length < 3) continue;
    let sum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0] * kmPerDegLon;
      const yi = ring[i][1] * KM_PER_DEG_LAT;
      const xj = ring[j][0] * kmPerDegLon;
      const yj = ring[j][1] * KM_PER_DEG_LAT;
      sum += xj * yi - xi * yj;
    }
    // First ring is the outer boundary (additive); subsequent rings are
    // holes (subtractive). GeoJSON convention.
    const ringArea = Math.abs(sum) / 2;
    total += r === 0 ? ringArea : -ringArea;
  }
  return Math.max(0, total);
}

/// Load the cached map of polygon name → area in km² for a city. Cached
/// in module memory for the lifetime of the function instance because the
/// polygon files are immutable static assets — no point re-parsing.
export async function loadPolygonAreas(citySlug: string): Promise<Map<string, number>> {
  const cached = cache.get(citySlug);
  if (cached) return cached;

  const m = new Map<string, number>();
  try {
    const filepath = path.join(process.cwd(), "public", "geo", `${citySlug}.geojson`);
    const raw = await fs.readFile(filepath, "utf-8");
    const data = JSON.parse(raw) as GeoCollection;
    for (const f of data.features) {
      const name = f.properties?.name;
      if (!name) continue;
      let area = 0;
      if (f.geometry.type === "Polygon") {
        area = polygonAreaSqKm(f.geometry.coordinates as GeoRing[]);
      } else if (f.geometry.type === "MultiPolygon") {
        for (const poly of f.geometry.coordinates as GeoRing[][]) {
          area += polygonAreaSqKm(poly);
        }
      }
      if (area > 0) m.set(name, area);
    }
  } catch {
    // No polygon file or parse error — return an empty map so the
    // caller falls back to peer-share.
  }
  cache.set(citySlug, m);
  return m;
}

/// Normalize a name for fuzzy matching between polygon `properties.name`
/// strings and adapter slugs/labels. Mirrors the normName logic used by
/// CrimeMap on the client so server-side polygon area lookup follows the
/// same matching rules.
export function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

/// Look up the polygon area in km² that best matches the given area
/// label, using the same normalize-and-substring matching the CrimeMap
/// uses for stats lookups. Returns null when no match is found.
export function lookupAreaKm2(areaLabel: string, polygonAreas: Map<string, number>): number | null {
  if (polygonAreas.size === 0) return null;
  const target = normName(areaLabel);
  // Exact normalized match first.
  for (const [name, area] of polygonAreas) {
    if (normName(name) === target) return area;
  }
  // Substring fallback.
  for (const [name, area] of polygonAreas) {
    const n = normName(name);
    if (n.includes(target) || target.includes(n)) return area;
  }
  return null;
}

/// Sum of every polygon area in a city. Used to derive the city's
/// total area for density calculations.
export function totalCityKm2(polygonAreas: Map<string, number>): number {
  let total = 0;
  for (const area of polygonAreas.values()) total += area;
  return total;
}
