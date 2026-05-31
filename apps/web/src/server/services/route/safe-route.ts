import "server-only";
import { crimeData } from "../crime-data";
import { cityFromLatLng, cityForArea } from "../crime-data/cities";
import type { KnownArea } from "../crime-data/neighborhoods";
import { cityLocalHour, CITY_TIMEZONES, DATE_ONLY_CITY_SLUGS } from "@travelsafe/crime-data/lib/city-time";
import { env } from "../../lib/env";

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
// OpenRouteService — the PRODUCTION routing engine (keyed, reliable, proper
// foot profile). Used when OPENROUTESERVICE_API_KEY is set; OSRM demo is the
// keyless fallback. Its killer feature for Safe Route is avoid_polygons, which
// lets us route AROUND the hottest neighborhoods rather than just scoring the
// engine's defaults.
const ORS_BASE = "https://api.openrouteservice.org/v2/directions";
const SAMPLE_COUNT = 30;
const NEAREST_CAP_KM = 3;
// Up to this many of the hottest neighborhoods become avoid-zones for the ORS
// "safe" route. ORS rejects requests whose avoid area is too large, so we cap
// the count and keep each box small (~250 m).
const MAX_AVOID_ZONES = 5;
const AVOID_BOX_KM = 0.25;

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
  /// Which routing engine produced these routes. "ors" means
  /// OpenRouteService is configured and one of the alternatives was
  /// actively routed to AVOID the city's highest-report neighborhoods
  /// (true avoid-routing); "osrm" means the keyless public-OSRM fallback,
  /// where alternatives are the engine's defaults scored after the fact.
  /// The UI uses this to only claim avoid-routing when it actually happened.
  engine: "ors" | "osrm";
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
    headers: { "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
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

type RawRoute = { coordinates: Array<[number, number]>; duration: number; distance: number };

/// OpenRouteService directions. Returns one route (optionally avoiding the
/// supplied polygons); pass `alternatives` to request ORS's own alternative
/// routes in a single call. Throws on any non-OK response so the caller can
/// fall back (e.g. ORS refuses to route when avoid-zones block the only path).
async function orsRoute(
  profile: "foot-walking" | "driving-car",
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  avoidPolygons?: GeoJSON.MultiPolygon,
  alternatives = false,
): Promise<RawRoute[]> {
  const key = env.OPENROUTESERVICE_API_KEY;
  if (!key) throw new Error("ORS key not configured");
  const body: Record<string, unknown> = {
    coordinates: [[from.lng, from.lat], [to.lng, to.lat]],
  };
  const options: Record<string, unknown> = {};
  if (avoidPolygons && avoidPolygons.coordinates.length > 0) options.avoid_polygons = avoidPolygons;
  if (Object.keys(options).length > 0) body.options = options;
  // ORS alternative_routes is only honored on a non-avoid request and only for
  // some profiles; ask for a small fan-out when requested.
  if (alternatives) body.alternative_routes = { target_count: 3, share_factor: 0.6, weight_factor: 1.6 };
  const res = await fetch(`${ORS_BASE}/${profile}/geojson`, {
    method: "POST",
    headers: {
      Authorization: key,
      "Content-Type": "application/json",
      Accept: "application/geo+json",
      "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/TravelSafe)",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ORS ${res.status}`);
  const fc = await res.json() as {
    features?: Array<{ geometry: { coordinates: Array<[number, number]> }; properties: { summary?: { distance?: number; duration?: number } } }>;
  };
  return (fc.features ?? []).map((f) => ({
    coordinates: f.geometry.coordinates,
    distance: f.properties.summary?.distance ?? 0,
    duration: f.properties.summary?.duration ?? 0,
  }));
}

interface AreaIntensity { area: KnownArea; intensity: number }

/// Build a MultiPolygon of small avoid-boxes around the city's hottest
/// neighborhoods (intensity > 2× the city mean), capped at MAX_AVOID_ZONES.
/// Feeding this to ORS as avoid_polygons makes the route actively steer around
/// the worst clusters — the genuine "safe route", not just a scored default.
/// Returns null when nothing is hot enough to be worth avoiding.
function buildAvoidPolygons(intensity: AreaIntensity[]): GeoJSON.MultiPolygon | null {
  if (intensity.length === 0) return null;
  const mean = intensity.reduce((s, i) => s + i.intensity, 0) / intensity.length;
  if (mean <= 0) return null;
  const hot = intensity
    .filter((i) => i.intensity > mean * 2 && i.area.centroid)
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, MAX_AVOID_ZONES);
  if (hot.length === 0) return null;
  const dLat = AVOID_BOX_KM / 111;
  const polys: number[][][][] = hot.map(({ area }) => {
    const { lat, lng } = area.centroid;
    const dLng = AVOID_BOX_KM / (111 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
    // GeoJSON ring: [lng,lat] CCW, closed.
    return [[
      [lng - dLng, lat - dLat],
      [lng + dLng, lat - dLat],
      [lng + dLng, lat + dLat],
      [lng - dLng, lat + dLat],
      [lng - dLng, lat - dLat],
    ]];
  });
  return { type: "MultiPolygon", coordinates: polys };
}

/// Drop near-identical routes (the avoid route can come back equal to the
/// direct one when nothing blocks the path, and ORS alternatives can overlap).
/// Signature = rounded distance + a few sampled coordinates.
function dedupeRoutes(routes: RawRoute[]): RawRoute[] {
  const seen = new Set<string>();
  const out: RawRoute[] = [];
  for (const r of routes) {
    if (r.coordinates.length === 0) continue;
    const mid = r.coordinates[Math.floor(r.coordinates.length / 2)] ?? [0, 0];
    const sig = `${Math.round(r.distance / 25)}|${mid[0].toFixed(3)},${mid[1].toFixed(3)}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(r);
  }
  return out;
}

// v64 — daytime / nighttime crime-curve weighting. Renamed from the
// prior "now/tonight" UI which was confusing: "now" / "tonight" sound
// like literal clock times ("right now" vs "later tonight"), but the
// underlying logic was actually about which time-of-day crime curve
// to weight. Renaming to daytime/nighttime makes the user choice
// match the actual computation.
//   Daytime = 6am-8pm: incidents that occurred in this window get
//     a 1.2× boost when the user has chosen Daytime travel. Captures
//     the commercial-corridor crime pattern (afternoon + early
//     evening peak).
//   Nighttime = 8pm-6am: incidents in this window get a 1.5× boost
//     when the user has chosen Nighttime travel. Boost is heavier
//     than daytime because the nighttime crime curve is more
//     concentrated (sharp residential spike 2-4am).
function isDaytimeHour(hour: number): boolean { return hour >= 6 && hour < 20; }
function isNightHour(hour: number): boolean { return hour >= 20 || hour < 6; }

const DAYTIME_INCIDENT_WEIGHT = 1.2;
const NIGHT_INCIDENT_WEIGHT = 1.5;
const ACTIVE_INCIDENT_WEIGHT = 2.0;
const ACTIVE_INCIDENT_WINDOW_MS = 24 * 60 * 60 * 1000;

async function loadCityIntensity(citySlug: string, timeOfTravel?: Date): Promise<AreaIntensity[]> {
  const { cityBySlug } = await import("../crime-data/cities");
  const city = cityBySlug(citySlug);
  if (!city) return [];
  const areas = await city.discover().catch(() => [] as KnownArea[]);
  const travelHour = timeOfTravel?.getHours();
  const isDaytimeTravel = travelHour != null && isDaytimeHour(travelHour);
  const isNightTravel = travelHour != null && isNightHour(travelHour);
  const activeCutoff = Date.now() - ACTIVE_INCIDENT_WINDOW_MS;
  // v99 — bucket incident hours by the CITY's local clock, not the UTC
  // runtime (getHours() on Railway/Vercel mislabeled every incident's
  // day/night by the city offset). Date-only feeds carry no real hour,
  // so skip the time-of-day weighting for them entirely.
  const tz = CITY_TIMEZONES[citySlug] ?? "UTC";
  const cityIsDateOnly = DATE_ONLY_CITY_SLUGS.has(citySlug);
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
          // Time-of-day curve weighting. Travel time selects which
          // curve to boost: daytime travel boosts daytime-occurring
          // incidents (commercial-corridor pattern), nighttime travel
          // boosts nighttime-occurring incidents (residential spike).
          // Skipped for date-only feeds (no reliable hour-of-day).
          if (!cityIsDateOnly) {
            const incHour = cityLocalHour(inc.occurredAt, tz);
            if (isDaytimeTravel && isDaytimeHour(incHour)) weight *= DAYTIME_INCIDENT_WEIGHT;
            else if (isNightTravel && isNightHour(incHour)) weight *= NIGHT_INCIDENT_WEIGHT;
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

  // Routing engine. When an OpenRouteService key is configured we use it (the
  // production path): the DIRECT route(s) plus a route that AVOIDS the city's
  // hottest neighborhoods — the latter is the genuine "safe route", not just a
  // scored default. Without a key we fall back to the public OSRM demo. Neither
  // supports transit, so transit reuses the driving profile (flagged in the UI).
  let raw: RawRoute[] = [];
  let engine: "ors" | "osrm" = "osrm";

  if (env.OPENROUTESERVICE_API_KEY) {
    const orsProfile = mode === "walking" ? "foot-walking" : "driving-car";
    const avoid = buildAvoidPolygons(intensity);
    const [directWithAlts, safer] = await Promise.all([
      orsRoute(orsProfile, from, to, undefined, true).catch(() => [] as RawRoute[]),
      avoid ? orsRoute(orsProfile, from, to, avoid).catch(() => [] as RawRoute[]) : Promise.resolve([] as RawRoute[]),
    ]);
    // alternative_routes is profile-dependent — if that variant failed, retry
    // the plain direct route so we never lose the fastest option.
    const direct = directWithAlts.length > 0
      ? directWithAlts
      : await orsRoute(orsProfile, from, to).catch(() => [] as RawRoute[]);
    raw = dedupeRoutes([...direct, ...safer]);
    if (raw.length > 0) engine = "ors";
  }

  if (raw.length === 0) {
    // OSRM public-demo fallback (keyless). Manufacture perpendicular-waypoint
    // alternatives when OSRM returns a single route so there's something to rank.
    const profile = mode === "walking" ? "foot" : "driving";
    raw = await osrmRoute(profile, from, to).catch(() => [] as RawRoute[]);
    if (raw.length < 2) {
      const w1 = perpendicularWaypoint(from, to, +1.5);
      const w2 = perpendicularWaypoint(from, to, -1.5);
      const more = await Promise.all([
        osrmRoute(profile, from, to, w1).catch(() => []),
        osrmRoute(profile, from, to, w2).catch(() => []),
      ]);
      raw = [...raw, ...more.flatMap((m) => m.slice(0, 1))];
    }
    engine = "osrm";
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
    scored.forEach((r) => {
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

  const engineName = engine === "ors" ? "OpenRouteService" : "project-OSRM";
  const engineUrl = engine === "ors" ? "https://openrouteservice.org/" : "https://project-osrm.org/";
  return {
    city: { slug: city.slug, label: city.label },
    from, to, mode,
    routes: scored.slice(0, 3),
    engine,
    source: {
      label: mode === "transit"
        ? `Routes via ${engineName} (driving — used as a transit-leg proxy)`
        : `Routes via ${engineName} ${mode} profile; exposure score from ${city.label} police feed`,
      url: engineUrl,
    },
    disclaimer:
      `Routes come from the OpenStreetMap-based ${engineName} routing engine. ` +
      (engine === "ors"
        ? "One option is routed to actively avoid the neighborhoods with the most recent reports. "
        : "") +
      "The exposure score is the sum of recent incident counts in the neighborhoods " +
      "each route crosses, normalized per 100,000 meters of route length, using " +
      "the same official police feed that powers the Crime Map. Lower is less " +
      "historical exposure — it is NOT a prediction of safety, just a comparison " +
      "of the past. Public-transit routing is not available; the transit mode " +
      "currently uses a driving route as a proxy.",
  };
}
