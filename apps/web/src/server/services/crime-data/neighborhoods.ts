// Coarse San Diego neighborhood centroids used to map a (lat, lng) back to an
// area slug. This is intentionally a small static table — TODO: replace with
// an official neighborhood polygon set (e.g. SDPD beats GeoJSON) for accuracy.
export interface KnownArea {
  slug: string;
  label: string;
  jurisdiction: string;
  centroid: { lat: number; lng: number };
}

export const SD_AREAS: KnownArea[] = [
  { slug: "pacific-beach",  label: "Pacific Beach",  jurisdiction: "San Diego", centroid: { lat: 32.7997, lng: -117.2358 } },
  { slug: "hillcrest",      label: "Hillcrest",      jurisdiction: "San Diego", centroid: { lat: 32.7484, lng: -117.1641 } },
  { slug: "downtown-sd",    label: "Downtown",       jurisdiction: "San Diego", centroid: { lat: 32.7157, lng: -117.1611 } },
  { slug: "la-jolla",       label: "La Jolla",       jurisdiction: "San Diego", centroid: { lat: 32.8328, lng: -117.2713 } },
  { slug: "mission-valley", label: "Mission Valley", jurisdiction: "San Diego", centroid: { lat: 32.7707, lng: -117.1521 } },
  { slug: "mira-mesa",      label: "Mira Mesa",      jurisdiction: "San Diego", centroid: { lat: 32.9170, lng: -117.1450 } },
  { slug: "north-park",     label: "North Park",     jurisdiction: "San Diego", centroid: { lat: 32.7396, lng: -117.1294 } },
];

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function nearestArea(point: { lat: number; lng: number }): KnownArea | null {
  let best: { area: KnownArea; km: number } | null = null;
  for (const area of SD_AREAS) {
    const km = haversineKm(point, area.centroid);
    if (!best || km < best.km) best = { area, km };
  }
  // Cap at ~20km so a request from outside San Diego doesn't silently snap to one.
  return best && best.km < 20 ? best.area : null;
}

export function findArea(slugOrLabel: string): KnownArea | null {
  const needle = slugOrLabel.toLowerCase();
  return (
    SD_AREAS.find((a) => a.slug === needle) ||
    SD_AREAS.find((a) => a.label.toLowerCase() === needle) ||
    null
  );
}
