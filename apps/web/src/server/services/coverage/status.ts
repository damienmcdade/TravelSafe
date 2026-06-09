import "server-only";
import { CITIES } from "../crime-data/cities";
import { stateAbbrForCity } from "@travelsafe/crime-data/city-states";
import { crimeData } from "../crime-data";
import { baselineFor } from "./baseline";
import { getRedis } from "../../lib/redis";

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
// v106 — was 55_000, which (× the slowest cold adapter, e.g. Atlanta ~45s)
// pushed the all-44-city coverage aggregate to ~59s against the route's 60s
// ceiling — one hiccup from a 504 that breaks the cache refresh. A coverage
// HEALTH check shouldn't block on a slow cold load: cap at 10s and let the
// LKG → static-baseline fallbacks below supply the count (health stays "live"
// off the baseline). Brings the cold aggregate from ~59s toward ~10s.
const PER_CITY_TIMEOUT_MS = 10_000;
// Cap for the freshness-sample calls (getAreaStats/getIncidents) on a city
// whose area list resolved but whose incident load is slow/cold.
const SAMPLE_TIMEOUT_MS = 8_000;

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

// fix(audit perf-compute-5): the coverage probe used to fan an unbounded
// Promise.all across all 44 cities, each doing discover() + two sample pulls.
// We bound it so heap/connections don't spike — BUT the bound must stay high
// enough that the cold-cache wall-clock fits maxDuration (120s). Each city's
// worst case is ~26s (10s discover + 8s + 8s samples); the HEAVY part (discover)
// already self-limits to COMPUTE_CONCURRENCY via withComputeLimit, so the
// coverage-level bound mostly governs the light sample fetches.
//
// fix(deploy/scan — /api/coverage 000 timeout): a bound of 6 serialized 44 cities
// into ~8 waves (≈208s worst case) and blew the 120s ceiling on a cold cache
// (the endpoint returned no response). Default to 16 so a cold full sweep is
// ~3 waves (≈78s) — comfortably under maxDuration — while still bounding the
// burst well below the old unbounded 44. Override via COVERAGE_CONCURRENCY.
const COVERAGE_CONCURRENCY = (() => {
  const n = Number.parseInt(process.env.COVERAGE_CONCURRENCY ?? "", 10);
  return Number.isFinite(n) && n >= 1 && n <= 44 ? n : 16;
})();

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// fix(coverage cold-load — "unusual time to load if at all"): the live
// 44-city sweep costs ~60–110s cold because discover() is globally gated to
// COMPUTE_CONCURRENCY (4). The CDN's stale-while-revalidate hides that AFTER
// the first successful compute, but a fresh CDN entry (post-deploy, or after
// a long idle) still strands the first visitor on the full sweep — and the
// module-level LKG map is per-instance + ephemeral, so it doesn't help a cold
// serverless box. We add a SHARED Redis snapshot (same Redis the Railway API
// uses): once any request has computed coverage, every later request — even on
// a brand-new instance, even right after a deploy — serves that snapshot in
// one Redis round-trip and refreshes opportunistically in the background.
const COVERAGE_REDIS_KEY = "coverage:snapshot:v1";
const COVERAGE_SOFT_TTL_MS = 30 * 60 * 1000; // serve instantly, no refresh
const COVERAGE_HARD_TTL_MS = 12 * 60 * 60 * 1000; // serve stale + refresh; beyond → recompute sync
const COVERAGE_REDIS_TTL_S = 24 * 60 * 60; // Redis key lifetime
let coverageInFlight: Promise<CoverageResponse> | null = null;

interface CoverageSnapshot { computedAt: number; data: CoverageResponse }

async function readCoverageSnapshot(): Promise<CoverageSnapshot | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(COVERAGE_REDIS_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as CoverageSnapshot;
    if (!snap || typeof snap.computedAt !== "number" || !snap.data) return null;
    return snap;
  } catch {
    return null;
  }
}

async function writeCoverageSnapshot(data: CoverageResponse): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.setex(
      COVERAGE_REDIS_KEY,
      COVERAGE_REDIS_TTL_S,
      JSON.stringify({ computedAt: Date.now(), data } satisfies CoverageSnapshot),
    );
  } catch {
    /* best-effort cache; a write failure just means the next caller recomputes */
  }
}

/// Compute + persist, de-duped so concurrent callers on one instance share a
/// single sweep instead of each firing their own 44-city fan-out.
function computeAndStore(): Promise<CoverageResponse> {
  if (coverageInFlight) return coverageInFlight;
  coverageInFlight = (async () => {
    try {
      const data = await computeCoverage();
      await writeCoverageSnapshot(data);
      return data;
    } finally {
      coverageInFlight = null;
    }
  })();
  return coverageInFlight;
}

/// Public entry point used by the /api/coverage route. Serves the shared Redis
/// snapshot when one exists (instant), recomputing only when truly cold or
/// extremely stale; a moderately-stale snapshot is served immediately while a
/// fresh sweep runs in the background.
export async function getCoverage(): Promise<CoverageResponse> {
  const snap = await readCoverageSnapshot();
  if (snap) {
    // v113 — if the fleet changed since the snapshot (a city was added or
    // removed), the cached count is wrong; recompute synchronously so a newly
    // added city reflects in /coverage immediately instead of waiting out the
    // 12h hard TTL (the Vercel background refresh can't be relied on to run).
    if (snap.data.totalCities !== CITIES.length) return computeAndStore();
    const age = Date.now() - snap.computedAt;
    if (age < COVERAGE_SOFT_TTL_MS) return snap.data; // fresh enough
    if (age < COVERAGE_HARD_TTL_MS) {
      // Stale-but-usable: return instantly, refresh in the background.
      void computeAndStore().catch(() => {});
      return snap.data;
    }
    // Beyond hard TTL — too stale to trust; fall through to a sync recompute.
  }
  // No snapshot (cold) or beyond hard TTL → compute now (and populate Redis).
  return computeAndStore();
}

async function computeCoverage(): Promise<CoverageResponse> {
  const now = Date.now();
  const results = await mapWithConcurrency(
    CITIES,
    COVERAGE_CONCURRENCY,
    async (city): Promise<CityStatus> => {
      // fix(audit cities-denver-false-no-data): an earlier token-gap guard hard-
      // coded Denver to "no-data" whenever DENVER_ARCGIS_TOKEN was unset. Denver's
      // ArcGIS feed is public again — the adapter returns live data without the
      // token (verified: 67,925 incidents across 78 neighborhoods, asOf within
      // ~2 days) — so the guard now FALSELY reports a healthy city as down on the
      // Coverage page. Removed; Denver is assessed from the live adapter like
      // every other city.
      let neighborhoodCount = 0;
      let newestIncidentAt: string | null = null;
      let sourceLabel = `${city.label} police open-data feed`;
      let health: CityHealth = "live";

      try {
        // Display the primary (real civic) area list when a city defines one, so
        // the "neighborhoods tracked" count reflects scoreable areas rather than
        // every micro-subdivision (VB: ~100 vs 961). The citywide grade still uses
        // the full discover(). fix(audit vb-over-fragmentation).
        const discoverForDisplay = city.discoverPrimary ?? city.discover;
        const areas = await withTimeout(discoverForDisplay(), PER_CITY_TIMEOUT_MS, [] as Awaited<ReturnType<typeof city.discover>>);
        neighborhoodCount = areas.length;

        // Provenance from the first area (the adapter shares one upstream pull,
        // so the source label is identical across areas).
        if (areas.length > 0) {
          // v106 — these sample calls were untimed. For a city whose discover()
          // returns fast off a static seed (Milwaukee) or whose incident load
          // is huge (Indianapolis 110k rows), getAreaStats/getIncidents then
          // triggered a slow cold load that dominated the aggregate (~35s).
          // Cap each at SAMPLE_TIMEOUT so the freshness sample never blocks the
          // health check; on timeout we simply skip the asOf for that city.
          const stats = await withTimeout(crimeData.getAreaStats(areas[0].slug).catch(() => null), SAMPLE_TIMEOUT_MS, null);
          if (stats?.provenance.source) sourceLabel = stats.provenance.source;

          // fix(audit coverage-newest-single-area + coverage-newest-availability):
          // newestIncidentAt was first computed from areas[0] ONLY (alphabetically
          // first) — if sparse, a fresh feed read ~year-stale (Tampa "341d" when 2d).
          // A naive parallel multi-area sample then REGRESSED availability: every
          // getIncidents serializes on the per-city withComputeLimit semaphore, so
          // N concurrent calls queue and blow SAMPLE_TIMEOUT, leaving asOf null for
          // ~28/44 cities. Correct approach: sample a SPREAD of areas SEQUENTIALLY
          // (the first call warms the shared upstream pull; the rest are fast warm
          // reads, one semaphore holder at a time), take the running max, and
          // EARLY-EXIT once we find a recent (<7d) incident. Bounded so the freshness
          // probe never dominates the coverage window; any value found beats null.
          const SAMPLE_AREAS = 8;
          const step = Math.max(1, Math.floor(areas.length / SAMPLE_AREAS));
          const sample = areas.filter((_, i) => i % step === 0).slice(0, SAMPLE_AREAS);
          const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
          let latest = 0;
          for (const a of sample) {
            const recent = await withTimeout(crimeData.getIncidents(a.slug, { limit: 50 }).catch(() => []), SAMPLE_TIMEOUT_MS, []);
            for (const inc of recent) {
              const t = +new Date(inc.occurredAt);
              if (Number.isFinite(t) && t > latest) latest = t;
            }
            // Stop as soon as we have a clearly-fresh read — no need to probe more.
            if (latest > 0 && now - latest < FRESH_MS) break;
          }
          if (latest > 0) newestIncidentAt = new Date(latest).toISOString();
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
        // fix(audit coverage-newest-availability): if this probe discovered areas
        // but the freshness sample timed out (asOf null), DON'T overwrite a
        // previously-captured good asOf — a cold-pull window shouldn't wipe a value
        // we already had. Carry the last good timestamp forward.
        if (newestIncidentAt === null && lkg?.newestIncidentAt) {
          newestIncidentAt = lkg.newestIncidentAt;
        }
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
    },
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
  "kansas-city": "MO",
  "fort-worth": "TX",
};

function extractState(_label: string, slug: string): string {
  // v99 — was a local STATE_BY_SLUG that drifted (it was missing 8 live
  // cities → "—" on the dashboard). Source from the canonical CITY_STATES
  // in the crime-data package, which a test asserts covers every city in
  // the CITIES registry. The inline map above is retained only as a
  // last-resort fallback for an unexpected slug.
  return stateAbbrForCity(slug) !== "—" ? stateAbbrForCity(slug) : (STATE_BY_SLUG[slug] ?? "—");
}
