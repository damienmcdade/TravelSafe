import "server-only";
import { CITIES } from "../crime-data/cities";
import { crimeData } from "../crime-data";

/// Per-city status payload powering the public /coverage dashboard.
/// Aggregates everything users want to see at a glance: is this city
/// live, when did the upstream feed last refresh, how many neighborhoods
/// the adapter knows about, and the most recent published incident
/// (best proxy for "freshness of the underlying data" since adapter
/// pulls can succeed against a stale cached upstream).

export type CityHealth = "live" | "warming-up" | "no-data";

export interface CityStatus {
  slug: string;
  label: string;
  state: string;
  health: CityHealth;
  neighborhoodCount: number;
  /// ISO timestamp of the adapter's most recent successful upstream pull.
  /// Null when the adapter hasn't successfully fetched yet this session.
  adapterFetchedAt: string | null;
  /// ISO timestamp of the most recent incident the adapter has cached.
  /// Better proxy for "how fresh is the underlying data" than
  /// adapterFetchedAt — a successful adapter pull against a stale
  /// upstream still has an old asOf.
  newestIncidentAt: string | null;
  /// Human-readable source line (e.g. "SDPD NIBRS Crime Offenses ·
  /// data.sandiego.gov").
  source: string;
}

export interface CoverageResponse {
  generatedAt: string;
  totalCities: number;
  liveCities: number;
  totalNeighborhoods: number;
  cities: CityStatus[];
}

/// Build per-city status by querying each adapter's discover() +
/// getAreaStats() for a representative area. Runs in parallel across
/// all cities; cold-cache cost is dominated by the slowest adapter.
/// Edge-cached at the route layer for 5 minutes so repeat dashboard
/// hits are instant.
///
/// Per-city timeout prevents a single slow-loading adapter from
/// blowing past Vercel's 60s function budget. Because Promise.all
/// runs the per-city probes in parallel, the overall wall-clock
/// is bounded by the SLOWEST single city, not the sum — so each
/// city's timeout can be a significant fraction of the function
/// budget without risking a 504. 30s gives high-volume cold-cache
/// adapters (Charlotte and Cleveland's bumped 60-page fetches in
/// particular) enough room to land their first pull without
/// degrading to "warming-up" on the public dashboard.
const PER_CITY_TIMEOUT_MS = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const id = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => { clearTimeout(id); resolve(v); },
      () => { clearTimeout(id); resolve(fallback); },
    );
  });
}

export async function getCoverage(): Promise<CoverageResponse> {
  const now = Date.now();
  const results = await Promise.all(
    CITIES.map(async (city): Promise<CityStatus> => {
      let neighborhoodCount = 0;
      let newestIncidentAt: string | null = null;
      let sourceLabel = `${city.label} police open-data feed`;
      let health: CityHealth = "live";

      try {
        const areas = await withTimeout(city.discover(), PER_CITY_TIMEOUT_MS, [] as Awaited<ReturnType<typeof city.discover>>);
        neighborhoodCount = areas.length;

        // Sample the first area for provenance + asOf timestamp. One
        // sample is enough because the adapter shares its upstream pull
        // across all areas of the city.
        if (areas.length > 0) {
          const stats = await crimeData.getAreaStats(areas[0].slug).catch(() => null);
          if (stats?.provenance.source) sourceLabel = stats.provenance.source;
          const recent = await crimeData.getIncidents(areas[0].slug, { limit: 50 }).catch(() => []);
          if (recent.length > 0) {
            const latest = recent
              .map((i) => +new Date(i.occurredAt))
              .filter((t) => Number.isFinite(t) && t > 0)
              .sort((a, b) => b - a)[0];
            if (latest > 0) newestIncidentAt = new Date(latest).toISOString();
          }
        }

        if (neighborhoodCount === 0) health = "warming-up";
      } catch {
        health = "no-data";
      }

      return {
        slug: city.slug,
        label: city.label,
        state: extractState(city.label, city.slug),
        health,
        neighborhoodCount,
        adapterFetchedAt: new Date(now).toISOString(),
        newestIncidentAt,
        source: sourceLabel,
      };
    }),
  );

  // Sort: live first (most coverage), then warming-up, then no-data.
  const sorted = results.sort((a, b) => {
    const order = { "live": 0, "warming-up": 1, "no-data": 2 };
    if (order[a.health] !== order[b.health]) return order[a.health] - order[b.health];
    return b.neighborhoodCount - a.neighborhoodCount;
  });

  return {
    generatedAt: new Date(now).toISOString(),
    totalCities: CITIES.length,
    liveCities: sorted.filter((c) => c.health === "live").length,
    totalNeighborhoods: sorted.reduce((s, c) => s + c.neighborhoodCount, 0),
    cities: sorted,
  };
}

// State abbreviations aren't on the server-side CityEntry; mirror the
// client-side map. Kept inline to avoid a server→client cross-import.
const STATE_BY_SLUG: Record<string, string> = {
  "san-diego": "CA", "los-angeles": "CA", "san-francisco": "CA", "oakland": "CA",
  "chicago": "IL",
  "new-york": "NY", "buffalo": "NY",
  "seattle": "WA",
  "colorado-springs": "CO",
  "detroit": "MI",
  "washington-dc": "DC",
  "boston": "MA", "cambridge": "MA",
  "philadelphia": "PA", "pittsburgh": "PA",
  "cincinnati": "OH", "cleveland": "OH",
  "new-orleans": "LA", "baton-rouge": "LA",
  "dallas": "TX",
  "charlotte": "NC",
  "nashville": "TN",
  "minneapolis": "MN", "saint-paul": "MN",
  "milwaukee": "WI",
  "las-vegas": "NV",
  "boise": "ID",
  "tucson": "AZ",
  "kansas-city": "MO",
  "phoenix": "AZ",
};

function extractState(_label: string, slug: string): string {
  return STATE_BY_SLUG[slug] ?? "—";
}
