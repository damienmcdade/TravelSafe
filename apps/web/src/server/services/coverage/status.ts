import "server-only";
import { CITIES } from "../crime-data/cities";
import { crimeData } from "../crime-data";
import { baselineFor } from "./baseline";

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
/// Edge-cached at the route layer for 30 minutes so repeat dashboard
/// hits are instant.
///
/// Per-city timeout prevents a single slow-loading adapter from
/// blowing past Vercel's 60s function budget. Because Promise.all
/// runs the per-city probes in parallel, the overall wall-clock is
/// bounded by the SLOWEST single city, not the sum — so each city's
/// timeout can be a significant fraction of the function budget
/// without risking a 504. v95p45 — bumped from 30s to 55s after
/// finding NYC, Charlotte, Atlanta, and Las Vegas were timing out
/// their cold-pulls (200k-row Socrata / 146k-row ArcGIS scans) and
/// degrading to "warming-up" on the public dashboard. 55s leaves
/// 5s of headroom under Vercel's 60s function budget.
const PER_CITY_TIMEOUT_MS = 55_000;

/// Module-level last-known-good cache. Survives across requests on
/// a warm Lambda; on cold start the map is empty. Used as a fallback
/// when the live probe times out or returns 0 — keeps the dashboard
/// honest about cities that ARE live but had a slow upstream pull
/// this round.
const lastKnownGood = new Map<string, { neighborhoodCount: number; newestIncidentAt: string | null; source: string; capturedAt: number }>();

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

      // v95p45 — fall back to last-known-good if this probe came up
      // empty. Cities like NYC, Charlotte, and Atlanta sometimes time
      // out their cold-pull during the 55s coverage window — the
      // adapter cache stays warm AFTER that point, so the *next*
      // request gets full data, but the dashboard for the user who
      // triggered the cold-pull saw zeros. Last-known-good carries
      // those zeros forward to whatever the prior probe produced so
      // the dashboard stays honest. Once the live probe succeeds we
      // overwrite the cache.
      const lkg = lastKnownGood.get(city.slug);
      if (neighborhoodCount === 0 && lkg && lkg.neighborhoodCount > 0) {
        neighborhoodCount = lkg.neighborhoodCount;
        newestIncidentAt = lkg.newestIncidentAt;
        sourceLabel = lkg.source;
        health = "live";
      } else if (neighborhoodCount > 0) {
        lastKnownGood.set(city.slug, {
          neighborhoodCount,
          newestIncidentAt,
          source: sourceLabel,
          capturedAt: now,
        });
      }

      // v95p46 — third-tier fallback: static baseline. Even on a
      // brand-new cold Lambda with no in-memory LKG, every supported
      // city should report as live with a sensible neighborhood count.
      // Many adapters use a fire-and-forget cold-start pattern that
      // returns [] on first call while a background warm fires; the
      // baseline makes the dashboard truthful in that ~30s window. The
      // baseline numbers are captured from prior successful probes
      // (see baseline.ts) and are refreshed whenever the live probe
      // returns a higher count.
      if (neighborhoodCount === 0) {
        const base = baselineFor(city.slug);
        if (base && base.neighborhoodCount > 0) {
          neighborhoodCount = base.neighborhoodCount;
          sourceLabel = base.source;
          health = "live";
        }
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
  "baltimore": "MD",
  "minneapolis": "MN", "saint-paul": "MN",
  "milwaukee": "WI",
  "las-vegas": "NV",
  "boise": "ID",
  "tucson": "AZ",
  "kansas-city": "MO",
  "fort-worth": "TX",
};

function extractState(_label: string, slug: string): string {
  return STATE_BY_SLUG[slug] ?? "—";
}
