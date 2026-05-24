import "server-only";
import { crimeData } from "../crime-data";
import { cityFromLatLng, cityForArea } from "../crime-data/cities";
import type { KnownArea } from "../crime-data/neighborhoods";

/// Dynamic Safe-Route Navigation.
///
/// We do NOT ship our own routing engine. Instead we hit the public OSRM
/// demo at router.project-osrm.org for walking + driving polylines (no key,
/// rate-limited but adequate for a per-user-request feature), then SCORE
/// each returned alternative against our already-collected police data:
///
///   1. Sample ~30 evenly-spaced points along each route polyline.
///   2. For each sample, find the nearest known neighborhood centroid in
///      the city (haversine distance, cap at ~3km so a point that doesn't
///      meaningfully belong to any tracked area contributes nothing).
///   3. Pull that area's recent-incident count from the same adapter that
///      powers the Crime Map.
///   4. Average the per-sample counts across the route → exposure score.
///   5. Rank by exposure ascending — lowest exposure = "safest route".
///
/// Public-transit routing isn't supported by OSRM. We surface "driving"
/// for that mode in v1 with a clear UI note that it represents the
/// driving leg of a transit trip; native transit routing would require
/// per-city OpenTripPlanner instances or a paid API.

const OSRM_BASE = "https://router.project-osrm.org/route/v1";
const SAMPLE_COUNT = 30;
const NEAREST_CAP_KM = 3;

export type Mode = "walking" | "driving" | "transit";

export interface RouteAlt {
  /// Polyline as an array of [lng, lat] pairs — directly renderable by Leaflet.
  coordinates: Array<[number, number]>;
  /// Driving/walking duration in seconds.
  durationSec: number;
  /// Route length in meters.
  distanceMeters: number;
  /// Sum of incident counts encountered along the route, weighted by
  /// distance spent in each area. Higher = more crime exposure.
  exposureScore: number;
  /// Per-100k normalized version of the exposure for cross-route comparison.
  exposurePer100k: number;
  /// Up to 5 named neighborhoods this route passes through (in order).
  passesThrough: string[];
  /// One-line summary text the UI can drop in directly.
  headline: string;
  /// Letter rating: A (least exposure) through E (most). Comparative within
  /// the returned set, NOT an absolute claim about safety.
  rating: "A" | "B" | "C" | "D" | "E";
}

export interface SafeRouteResponse {
  city: { slug: string; label: string };
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  mode: Mode;
  /// Routes sorted safest first.
  routes: RouteAlt[];
  source: { label: string; url: string };
  disclaimer: string;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/// Evenly resample the polyline into N points (including endpoints). Output
/// is in [lng, lat] form, same as the input — easier to feed back to Leaflet.
function resample(coords: Array<[number, number]>, n: number): Array<[number, number]> {
  if (coords.length === 0) return [];
  if (coords.length <= n) return coords;
  // Cumulative arc length, normalized 0..1
  const len: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = coords[i - 1];
    const [x2, y2] = coords[i];
    len.push(len[i - 1] + Math.hypot(x2 - x1, y2 - y1));
  }
  const total = len[len.length - 1];
  if (total === 0) return [coords[0]];
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const target = (total * i) / (n - 1);
    // Find segment containing target.
    let lo = 0;
    while (lo < len.length - 1 && len[lo + 1] < target) lo++;
    const t = (target - len[lo]) / Math.max(1e-9, (len[lo + 1] - len[lo]));
    const [x1, y1] = coords[lo];
    const [x2, y2] = coords[Math.min(lo + 1, coords.length - 1)];
    out.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
  }
  return out;
}

function ratingFromRank(idx: number, total: number): RouteAlt["rating"] {
  if (total <= 1) return "C";
  const p = idx / (total - 1);
  if (p < 0.2) return "A";
  if (p < 0.45) return "B";
  if (p < 0.65) return "C";
  if (p < 0.85) return "D";
  return "E";
}

/// Generate a polyline alternative-style by injecting a perpendicular
/// waypoint. Used when OSRM returns only one route to give the user some
/// comparable options.
function perpendicularWaypoint(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  offsetKm: number,
): { lat: number; lng: number } {
  // Unit vector from→to
  const dx = to.lng - from.lng;
  const dy = to.lat - from.lat;
  const len = Math.hypot(dx, dy);
  if (len === 0) return from;
  // Perpendicular in lat/lng space (rough — fine for ~few-km offsets)
  const px = -dy / len;
  const py = dx / len;
  // Convert km offset to degrees (~111km / degree for lat)
  const offsetDeg = offsetKm / 111;
  // Midpoint nudged perpendicular
  return {
    lat: (from.lat + to.lat) / 2 + py * offsetDeg,
    lng: (from.lng + to.lng) / 2 + px * offsetDeg,
  };
}

async function osrmRoute(
  profile: "foot" | "driving",
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  via?: { lat: number; lng: number },
): Promise<Array<{ coordinates: Array<[number, number]>; duration: number; distance: number }>> {
  const coords = via
    ? `${from.lng},${from.lat};${via.lng},${via.lat};${to.lng},${to.lat}`
    : `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url = `${OSRM_BASE}/${profile}/${coords}?overview=full&geometries=geojson&alternatives=3`;
  const res = await fetch(url, {
    headers: { "User-Agent": "TravelSafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
    // Public OSRM demo can be slow; cap so a hung server doesn't hang us.
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const body = await res.json() as { routes?: Array<{ duration: number; distance: number; geometry: { coordinates: Array<[number, number]> } }> };
  return (body.routes ?? []).map((r) => ({
    coordinates: r.geometry.coordinates,
    duration: r.duration,
    distance: r.distance,
  }));
}

interface AreaIntensity { area: KnownArea; intensity: number }

// Time-of-day boundaries for "nighttime" — 8pm to 6am. Routes
// planned for this window weight incidents that ALSO occurred at
// night more heavily, on the theory that crime patterns are
// shift-correlated and a daytime-friendly area can be meaningfully
// busier after dark. Boundaries are intentionally inclusive of
// dusk/dawn so 7pm and 6am don't fall in a no-mans-land.
function isNightHour(hour: number): boolean {
  return hour >= 20 || hour < 6;
}

// Weight multipliers applied per-incident when scoring a route.
// Defaults to 1.0 (no weighting). Nighttime travel + nighttime
// incident → 1.5× weight. Active incidents (last 24h) → 2× weight
// regardless of time-of-travel — recent activity is the strongest
// signal that an area is currently hot.
const NIGHT_INCIDENT_WEIGHT = 1.5;
const ACTIVE_INCIDENT_WEIGHT = 2.0;
const ACTIVE_INCIDENT_WINDOW_MS = 24 * 60 * 60 * 1000;

async function loadCityIntensity(citySlug: string, timeOfTravel?: Date): Promise<AreaIntensity[]> {
  const { cityBySlug } = await import("../crime-data/cities");
  const city = cityBySlug(citySlug);
  if (!city) return [];
  const areas = await city.discover().catch(() => [] as KnownArea[]);
  const isNightTravel = timeOfTravel ? isNightHour(timeOfTravel.getHours()) : false;
  const activeCutoff = Date.now() - ACTIVE_INCIDENT_WINDOW_MS;
  // Pull each area's recent incident count in parallel — the adapter caches
  // the city-wide pull so all 100 areas share one upstream fetch.
  const intensities = await Promise.all(
    areas.map(async (a) => {
      const incidents = await crimeData.getIncidents(a.slug, { limit: 5000 }).catch(() => []);
      let intensity = 0;
      for (const inc of incidents) {
        let weight = 1;
        const incTime = +new Date(inc.occurredAt);
        if (Number.isFinite(incTime)) {
          // Nighttime weighting: incident occurred at night AND user
          // is planning to travel at night → boost.
          if (isNightTravel) {
            const incHour = new Date(incTime).getHours();
            if (isNightHour(incHour)) weight *= NIGHT_INCIDENT_WEIGHT;
          }
          // Active-incident avoidance: anything in the last 24h
          // gets a 2× boost regardless of travel time. Catches the
          // "shooting on this block tonight" pattern.
          if (incTime > activeCutoff) weight *= ACTIVE_INCIDENT_WEIGHT;
        }
        intensity += weight;
      }
      return { area: a, intensity };
    }),
  );
  return intensities;
}

function nearestIntensity(point: [number, number], pool: AreaIntensity[]): { name: string; intensity: number } | null {
  const [lng, lat] = point;
  let best: { name: string; intensity: number; km: number } | null = null;
  for (const p of pool) {
    const km = haversineKm({ lat, lng }, p.area.centroid);
    if (km > NEAREST_CAP_KM) continue;
    if (!best || km < best.km) best = { name: p.area.label, intensity: p.intensity, km };
  }
  return best ? { name: best.name, intensity: best.intensity } : null;
}

function scoreRoute(
  coords: Array<[number, number]>,
  intensity: AreaIntensity[],
  distanceMeters: number,
): { exposureScore: number; exposurePer100k: number; passesThrough: string[] } {
  const samples = resample(coords, SAMPLE_COUNT);
  const passSeq: string[] = [];
  let sum = 0;
  for (const s of samples) {
    const hit = nearestIntensity(s, intensity);
    if (!hit) continue;
    sum += hit.intensity;
    if (passSeq[passSeq.length - 1] !== hit.name) passSeq.push(hit.name);
  }
  const exposureScore = Math.round(sum);
  // Per-100k normalized: incidents per sample × 100,000 / route length(m).
  // This gives a comparable score across short walks vs long drives.
  const exposurePer100k = distanceMeters > 0
    ? Math.round((exposureScore / Math.max(1, samples.length)) * 100_000 / distanceMeters)
    : 0;
  // De-duplicate consecutive area names, cap to top 5.
  const passesThrough = passSeq.filter((v, i, arr) => v && (i === 0 || arr[i - 1] !== v)).slice(0, 5);
  return { exposureScore, exposurePer100k, passesThrough };
}

export async function getSafeRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  mode: Mode,
  /// Optional planned travel time. When falls in the night window
  /// (20:00-06:00), the scorer boosts the weight of nighttime
  /// incidents. Active incidents (last 24h) are always boosted
  /// regardless of this value.
  timeOfTravel?: Date,
): Promise<SafeRouteResponse> {
  // Pick the city the route mostly belongs to (use the midpoint).
  const mid = { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 };
  const city = cityFromLatLng(mid) ?? cityForArea("");

  const intensity = await loadCityIntensity(city.slug, timeOfTravel);

  // OSRM doesn't support transit. For mode=transit, score the driving
  // alternative and mark it clearly in the UI / source labels.
  const profile = mode === "walking" ? "foot" : "driving";

  let raw = await osrmRoute(profile, from, to).catch(() => [] as Awaited<ReturnType<typeof osrmRoute>>);
  // If OSRM only returned a single route, manufacture two more by routing
  // through perpendicular waypoints — gives the user something to compare.
  if (raw.length < 2) {
    const w1 = perpendicularWaypoint(from, to, +1.5);
    const w2 = perpendicularWaypoint(from, to, -1.5);
    const more = await Promise.all([
      osrmRoute(profile, from, to, w1).catch(() => []),
      osrmRoute(profile, from, to, w2).catch(() => []),
    ]);
    raw = [...raw, ...more.flatMap((m) => m.slice(0, 1))];
  }

  const scored: RouteAlt[] = raw.map((r) => {
    const { exposureScore, exposurePer100k, passesThrough } = scoreRoute(r.coordinates, intensity, r.distance);
    return {
      coordinates: r.coordinates,
      durationSec: Math.round(r.duration),
      distanceMeters: Math.round(r.distance),
      exposureScore,
      exposurePer100k,
      passesThrough,
      headline: passesThrough.length > 0
        ? `Passes through ${passesThrough.join(" → ")}.`
        : "Route does not cross a tracked neighborhood with recorded incidents.",
      rating: "C", // overwritten below after sorting
    };
  });

  // Sort safest first (lowest per-100k exposure).
  scored.sort((a, b) => a.exposurePer100k - b.exposurePer100k);
  scored.forEach((r, i) => { r.rating = ratingFromRank(i, scored.length); });

  // Rewrite the headline now that we have the full sorted set so
  // each route can be described RELATIVE to its peers. The safest
  // option calls that out, the worst flags its peers as safer, and
  // any route passing through a notably-hot neighborhood (a polygon
  // whose intensity exceeds the city's per-area average by 2×)
  // gets that called out by name. Gives users the "why this route
  // is safer" rationale the strategy doc asked for.
  if (scored.length > 0) {
    const meanIntensity = intensity.length > 0
      ? intensity.reduce((s, i) => s + i.intensity, 0) / intensity.length
      : 0;
    const hotNeighborhoods = new Set<string>();
    for (const ai of intensity) {
      if (meanIntensity > 0 && ai.intensity > meanIntensity * 2) hotNeighborhoods.add(ai.area.label);
    }
    const safest = scored[0];
    const worst = scored[scored.length - 1];
    scored.forEach((r, i) => {
      const isSafest = scored.length > 1 && r === safest;
      const isWorst = scored.length > 1 && r === worst;
      const hotCrossed = r.passesThrough.filter((n) => hotNeighborhoods.has(n));
      const pct = scored.length > 1 && safest.exposurePer100k > 0
        ? Math.round(((r.exposurePer100k - safest.exposurePer100k) / safest.exposurePer100k) * 100)
        : 0;

      const parts: string[] = [];
      if (isSafest && scored.length > 1) {
        parts.push("Safest option — lowest historical incident exposure.");
      } else if (isWorst && scored.length > 2) {
        parts.push(`Highest exposure of the ${scored.length} options${pct > 0 ? ` (~${pct}% above the safest)` : ""}.`);
      } else if (scored.length > 1 && pct > 0) {
        parts.push(`~${pct}% more exposure than the safest option.`);
      }
      if (hotCrossed.length > 0) {
        parts.push(`Crosses ${hotCrossed.slice(0, 2).join(" + ")} where reports cluster.`);
      } else if (r.passesThrough.length > 0 && !isSafest) {
        // Mention which neighborhoods get crossed when none are
        // "hot" — at least the user gets a route description.
        parts.push(`Passes through ${r.passesThrough.slice(0, 3).join(" → ")}.`);
      }
      if (parts.length === 0) {
        parts.push(r.passesThrough.length > 0
          ? `Passes through ${r.passesThrough.join(" → ")}.`
          : "Route does not cross a tracked neighborhood with recorded incidents.");
      }
      r.headline = parts.join(" ");
    });
  }

  return {
    city: { slug: city.slug, label: city.label },
    from, to, mode,
    routes: scored.slice(0, 3),
    source: {
      label: mode === "transit"
        ? "Routes via project-OSRM (driving — used as a transit-leg proxy)"
        : `Routes via project-OSRM ${mode} profile; exposure score from ${city.label} police feed`,
      url: "https://project-osrm.org/",
    },
    disclaimer:
      "Routes come from the OpenStreetMap-based OSRM routing engine. The " +
      "exposure score is the sum of recent incident counts in the neighborhoods " +
      "each route crosses, normalized per 100,000 meters of route length, using " +
      "the same official police feed that powers the Crime Map. Lower is less " +
      "historical exposure — it is NOT a prediction of safety, just a comparison " +
      "of the past. Public-transit routing is not available; the transit mode " +
      "currently uses a driving route as a proxy.",
  };
}
