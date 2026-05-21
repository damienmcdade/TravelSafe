import { SD_AREAS, nearestArea, type KnownArea } from "../crime-data/neighborhoods";
import { crimeData } from "../crime-data";

export interface SafeRouteSegment {
  area: KnownArea;
  riskLevel: 1 | 2 | 3 | 4 | 5;
  rationale: string;
}

export interface SafeRoutePlan {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  segments: SafeRouteSegment[];
  flaggedHigherRiskAreas: KnownArea[];
  disclaimer: string;
}

/// VERY coarse "safe route" stub. Takes the line between origin and destination,
/// samples every ~1km, and assigns the nearest known area to each sample.
/// TODO: replace with a real routing engine (OSRM / Valhalla / Google Maps)
/// and feed it neighborhood polygons rather than centroids.
export async function planSafeRoute(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<SafeRoutePlan> {
  const samples = 8;
  const sampled: KnownArea[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
    const area = nearestArea(p);
    if (area && !sampled.some((s) => s.slug === area.slug)) sampled.push(area);
  }

  const segments: SafeRouteSegment[] = [];
  for (const area of sampled) {
    const stats = await crimeData.getAreaStats(area.slug);
    const rl = (stats?.riskLevel ?? 3) as SafeRouteSegment["riskLevel"];
    segments.push({
      area,
      riskLevel: rl,
      rationale: stats ? `Based on ${stats.provenance.source}` : "No data — risk shown as neutral",
    });
  }

  return {
    from,
    to,
    segments,
    flaggedHigherRiskAreas: segments.filter((s) => s.riskLevel >= 4).map((s) => s.area),
    disclaimer:
      "TravelSafe does not provide turn-by-turn routing. Risk is shown at the neighborhood level using public crime data and is illustrative only. Use a navigation app for directions.",
  };
}

export const _knownAreasForTests = SD_AREAS;
