// USGS Earthquakes — free, public, no-key US gov API
// (earthquake.usgs.gov/fdsnws). We pull M2.5+ events in the past 3
// days within ~300km of the user's city centroid. Cached for 5 minutes
// per centroid since USGS publishes near-real-time and we don't want
// to hammer the API on every page hit.

import type { OfficialAlert } from "./nws";

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { fetchedAt: number; alerts: OfficialAlert[] }>();

interface UsgsFeature {
  id: string;
  properties: {
    mag?: number;
    place?: string;
    time?: number;
    updated?: number;
    url?: string;
    detail?: string;
    title?: string;
    alert?: string | null;
    type?: string;
  };
}

/// Magnitudes 4.5+ are noticeable, 6.0+ are damaging, 7.0+ are major.
/// Map to the OfficialAlert severity scale so the card's existing
/// severity chip styling works without modification.
function severityForMagnitude(mag: number | undefined): OfficialAlert["severity"] {
  if (mag == null || !Number.isFinite(mag)) return "Unknown";
  if (mag >= 6.0) return "Extreme";
  if (mag >= 5.0) return "Severe";
  if (mag >= 4.0) return "Moderate";
  return "Minor";
}

/// Pull recent earthquakes within `radiusKm` of the given centroid.
/// Returns an empty list if the API errors, the centroid is missing,
/// or there's nothing recent — earthquakes are GENUINELY rare in most
/// cities so an empty list is the common case, not an error.
export async function getUsgsEarthquakes(
  centroid: { lat: number; lng: number } | null,
  radiusKm: number = 300,
): Promise<OfficialAlert[]> {
  if (!centroid) return [];
  const key = `${centroid.lat.toFixed(2)},${centroid.lng.toFixed(2)}|${radiusKm}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return hit.alerts;

  // 72-hour window. Earthquakes are sparse enough that anything older
  // is no longer "current" for an awareness card. M2.5+ filters out
  // the thousands of micro-tremors USGS publishes daily that aren't
  // perceptible.
  const starttime = new Date(now - 72 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    format: "geojson",
    latitude: centroid.lat.toFixed(4),
    longitude: centroid.lng.toFixed(4),
    maxradiuskm: String(radiusKm),
    minmagnitude: "2.5",
    starttime,
    orderby: "time",
    limit: "20",
  });
  try {
    const res = await fetch(`https://earthquake.usgs.gov/fdsnws/event/1/query?${params}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/TravelSafe)",
      },
      // fix(audit alerts-no-fetch-timeout-2): bound the upstream call; fall back to cache.
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return hit?.alerts ?? [];
    const json = (await res.json()) as { features?: UsgsFeature[] };
    const alerts: OfficialAlert[] = (json.features ?? []).map((f) => {
      const mag = f.properties.mag;
      const place = f.properties.place ?? "Unknown location";
      const time = f.properties.time ? new Date(f.properties.time).toISOString() : new Date().toISOString();
      return {
        id: `usgs:${f.id}`,
        source: "USGS Earthquakes",
        category: "Geo",
        severity: severityForMagnitude(mag),
        headline: mag != null
          ? `M${mag.toFixed(1)} earthquake — ${place}`
          : `Earthquake reported — ${place}`,
        description: `USGS-reported seismic event ${place}. Magnitude reflects energy at the source; perceived shaking depends on distance and local geology.`,
        effective: time,
        expires: null,
        url: f.properties.url ?? "https://earthquake.usgs.gov/earthquakes/map/",
      };
    });
    cache.set(key, { fetchedAt: now, alerts });
    return alerts;
  } catch {
    return hit?.alerts ?? [];
  }
}
