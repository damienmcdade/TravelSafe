// SD neighborhood discovery.
// Names + centroids are computed at request time from the cached SDPD NIBRS
// CSV (~100+ neighborhoods, each with a real centroid averaged from incident
// lat/lngs). The small hardcoded fallback is kept as a sync helper for code
// paths that aren't allowed to await — e.g., the legacy nearest-area mapper
// before the cache has warmed.

export interface KnownArea {
  slug: string;
  label: string;
  jurisdiction: string;
  centroid: { lat: number; lng: number };
}

// Tiny synchronous fallback list — only consulted while the async list is
// loading and as a last-resort for the nearest-area mapper.
const FALLBACK_AREAS: KnownArea[] = [
  { slug: "pacific-beach",  label: "Pacific Beach",  jurisdiction: "San Diego", centroid: { lat: 32.7997, lng: -117.2358 } },
  { slug: "hillcrest",      label: "Hillcrest",      jurisdiction: "San Diego", centroid: { lat: 32.7484, lng: -117.1641 } },
  { slug: "downtown-sd",    label: "Downtown",       jurisdiction: "San Diego", centroid: { lat: 32.7157, lng: -117.1611 } },
  { slug: "la-jolla",       label: "La Jolla",       jurisdiction: "San Diego", centroid: { lat: 32.8328, lng: -117.2713 } },
  { slug: "mission-valley", label: "Mission Valley", jurisdiction: "San Diego", centroid: { lat: 32.7707, lng: -117.1521 } },
  { slug: "mira-mesa",      label: "Mira Mesa",      jurisdiction: "San Diego", centroid: { lat: 32.9170, lng: -117.1450 } },
  { slug: "north-park",     label: "North Park",     jurisdiction: "San Diego", centroid: { lat: 32.7396, lng: -117.1294 } },
];

let lastDiscovered: KnownArea[] | null = null;

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/// Async — preferred. Pulls fresh discovered list from the SDPD CSV cache
/// and merges in the small fallback so the legacy seven always resolve too.
export async function listKnownAreas(): Promise<KnownArea[]> {
  // Lazy dynamic import keeps this module dep-free for the sync helpers.
  const { getDiscoveredAreas } = await import("./adapters/sdpd-nibrs");
  const discovered = await getDiscoveredAreas().catch(() => [] as KnownArea[]);
  lastDiscovered = discovered;
  const merged = new Map<string, KnownArea>();
  for (const a of FALLBACK_AREAS) merged.set(a.slug, a);
  for (const a of discovered) merged.set(a.slug, a);
  return Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label));
}

/// Sync — best-effort. Returns the most-recent discovered list if available,
/// otherwise the small fallback.
export function listKnownAreasSync(): KnownArea[] {
  return lastDiscovered && lastDiscovered.length > 0 ? lastDiscovered : FALLBACK_AREAS;
}

export function nearestArea(point: { lat: number; lng: number }): KnownArea | null {
  const areas = listKnownAreasSync();
  let best: { area: KnownArea; km: number } | null = null;
  for (const area of areas) {
    const km = haversineKm(point, area.centroid);
    if (!best || km < best.km) best = { area, km };
  }
  // Cap at ~20km so a request from outside San Diego doesn't silently snap to one.
  return best && best.km < 20 ? best.area : null;
}

export function findArea(slugOrLabel: string): KnownArea | null {
  const needle = slugOrLabel.toLowerCase();
  const all = listKnownAreasSync();
  return (
    all.find((a) => a.slug === needle) ||
    all.find((a) => a.label.toLowerCase() === needle) ||
    null
  );
}

// Kept as named export for routes that already import it directly.
export const SD_AREAS = FALLBACK_AREAS;
