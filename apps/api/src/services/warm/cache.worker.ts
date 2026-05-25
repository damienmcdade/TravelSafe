import { CITIES } from "@travelsafe/crime-data/cities";
import { crimeData } from "@travelsafe/crime-data/dispatcher";
import { getCitywideSafetyScore } from "@travelsafe/crime-data/safety-score";
import { getCitywideTrend } from "@travelsafe/crime-data/trend-feed";
import { getRedis } from "../../lib/redis.js";

// v69 — Redis L2 cache for warm-worker-computed citywide responses.
// Eliminates the 5-min cold-start cost on Railway container restart:
// when a new container boots, the L1 (in-process) cache is empty,
// but Redis still has the prior warm-worker's serialized results.
// Routes that check Redis first get an instant hit; the worker
// continues populating in-process cache in the background.
const REDIS_KEY_PREFIX = "citywide:";
const REDIS_TTL_SECONDS = 30 * 60; // 30min — well past the 4-min cycle

// v57 — periodic cache warmer for the heaviest cities. The adapter
// cache TTL is 5 minutes; without continuous warming, every cold-
// start request waits 30-60s for the upstream fetch (Detroit / KC /
// Cleveland with 100+ neighborhoods are the worst offenders, and
// Vercel's 60s function ceiling turns those into 504s for users).
//
// Vercel Cron on the Hobby plan only allows daily schedules, so we
// run the 4-minute warmer on Railway alongside the check-in and
// push-digest workers. Same pattern as digest.worker.ts.

const WARM_INTERVAL_MS = 4 * 60 * 1000; // 4m, just under the 5m TTL
let timer: NodeJS.Timeout | null = null;
let inFlight = false;

// Prioritize the cities with the heaviest cold-cache cost. These all
// have 100+ tracked neighborhoods, which fan out into many per-area
// adapter calls during getCitywide. Lighter cities (cambridge, boise)
// warm fast and don't need explicit attention.
const HEAVY_CITIES = [
  "detroit",         // 199 areas
  "kansas-city",     // 145 areas
  "cleveland",       //  35 (but bundled CFS adapter is slow)
  "san-diego",       // 125
  "norfolk",         // 122
  "oakland",         // 123
  "minneapolis",     //  86
  "pittsburgh",      //  90
  "new-orleans",     //  74
  "new-york",        //  78
  "colorado-springs",//  78
  "chicago",         //  77
];

async function warmCity(slug: string) {
  const start = Date.now();
  // v69 — capture the safety-score result and persist to Redis so route
  // handlers can serve cold-start requests in <10ms (Redis round-trip)
  // instead of recomputing per-area aggregation (50-200ms) or worse,
  // re-fetching the upstream adapter (5min on Cleveland cold). Other
  // calls (getCitywide, getCitywideTrend) just warm the in-process
  // cache as before; their payloads are too large for cheap Redis
  // serialization on every cycle.
  const [, scoreResult] = await Promise.allSettled([
    crimeData.getCitywide(slug),
    getCitywideSafetyScore(slug),
    getCitywideTrend(slug),
  ]);
  if (scoreResult.status === "fulfilled" && scoreResult.value) {
    // v70 followup — sanity-guard the Redis write. The audit caught
    // Detroit + Minneapolis serving windowDays=0 / all-zero counts
    // because a prior warm cycle had a transient upstream hiccup, the
    // safety-score computed a degenerate result (0 in-window
    // incidents), and the warm-worker dutifully wrote that broken
    // payload to Redis. Reads then served the broken value for the
    // full 30-min TTL even though the in-process cache was healthy.
    //
    // Now only persist if the result has meaningful data: at least
    // one in-window incident counted across PERSONS+PROPERTY AND a
    // non-zero windowDays. Otherwise the prior Redis entry stays
    // (it might be stale but it's not BROKEN) and the route can
    // fall through to in-process compute.
    const v = scoreResult.value;
    const rows = (v.rows ?? []) as Array<{ count?: number }>;
    const totalCounted = rows.reduce((s, r) => s + (r.count ?? 0), 0);
    const wd = (v as { windowDays?: number }).windowDays ?? 0;
    if (totalCounted > 0 && wd > 0) {
      const redis = getRedis();
      if (redis) {
        try {
          await redis.setex(`${REDIS_KEY_PREFIX}${slug}`, REDIS_TTL_SECONDS, JSON.stringify(v));
        } catch (err) {
          if (process.env.NODE_ENV !== "production") {
            console.warn(`[warm-worker] redis cache write failed for ${slug}:`, (err as Error).message);
          }
        }
      }
    } else if (process.env.NODE_ENV === "production") {
      console.log(`[warm-worker] skipping redis write for ${slug} (degenerate result: totalCounted=${totalCounted} windowDays=${wd})`);
    }
  }
  return Date.now() - start;
}

// v69 followup-3 — bounded-concurrency helper. Original tick fired
// all 12 heavy cities in parallel which triggered upstream rate
// limits on shared infrastructure (Cleveland's ArcGIS endpoint was
// the worst offender — see v63's bounded-concurrency cleveland
// adapter fix for the original incident). Cap heavy at 4, light at
// 10 so we don't thundering-herd any one upstream provider.
async function runBatched<T>(items: T[], concurrency: number, worker: (item: T) => Promise<number>): Promise<number[]> {
  const results: number[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function tick() {
  if (inFlight) return; // skip overlap if prior tick is still running
  inFlight = true;
  const cycleStart = Date.now();
  try {
    // Heavy at 4 concurrent (Cleveland's 5min cycle alone monopolizes
    // a slot; better to make small steady progress than all-at-once).
    // Light at 10 concurrent (each finishes in <500ms; overhead is
    // dominated by per-city in-process dispatch, not network).
    const heavyTimings = await runBatched(HEAVY_CITIES, 4, warmCity);
    const lightCities = CITIES.map((c) => c.slug).filter((s) => !HEAVY_CITIES.includes(s));
    const lightTimings = await runBatched(lightCities, 10, warmCity);
    const total = Date.now() - cycleStart;
    const avgHeavy = heavyTimings.length
      ? Math.round(heavyTimings.reduce((a, b) => a + b, 0) / heavyTimings.length)
      : 0;
    const avgLight = lightTimings.length
      ? Math.round(lightTimings.reduce((a, b) => a + b, 0) / lightTimings.length)
      : 0;
    console.log(`[warm-worker] cycle ${total}ms · heavy avg ${avgHeavy}ms · light avg ${avgLight}ms`);
  } catch (err) {
    console.error("[warm-worker] cycle failed:", err);
  } finally {
    inFlight = false;
  }
}

export function startWarmWorker() {
  if (timer) return;
  console.log(`[warm-worker] starting (cycle every ${WARM_INTERVAL_MS / 1000}s)`);
  timer = setInterval(() => void tick(), WARM_INTERVAL_MS);
  // v71 followup — fire an initial warm cycle 15s after boot rather
  // than waiting the full 4 min. Pre-v71 the audit caught Cleveland
  // serving 503 warming_up for ~4 min on every container restart
  // (its adapter takes ~30s for the bounded-concurrency 30-page
  // pagination, and the route's 25s timeout fires first). The Redis
  // L2 cache survives container restarts but only contains entries
  // for cities the PRIOR container warmed — a brand-new city or a
  // city missed by the previous cycle still cold-starts. Firing on
  // boot (delayed 15s so DB + Redis are fully wired) gets the
  // adapter caches populated before users hit the first request.
  setTimeout(() => void tick(), 15_000);
}

export function stopWarmWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  inFlight = false;
}
