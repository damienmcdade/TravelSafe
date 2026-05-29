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
// adapter calls during getCitywide.
// v96p2 — trimmed from 14 → 6. The bigger list kept the cumulative
// adapter cache hot enough to OOM the pod after a few cycles
// (multiple cities × 50k-row buffers × Incident object allocations
// stayed root-reachable in their respective module-level caches).
// Six heavyweights cover the high-traffic surfaces; everything else
// falls back to the lighter on-demand path with Redis L2 fronting.
const HEAVY_CITIES = [
  "detroit",      // 199 areas
  "kansas-city",  // 145 areas
  "san-diego",    // 125
  "los-angeles",  // two-dataset merge
  "new-york",     // dense per-area fan-out
  "chicago",      // bounded by 180d in a8bb33c but still wide
];

// v96 — per-city deadline. Without this, a single hung adapter (one
// that escapes the new global undici 30 s timeout because the JS
// promise itself doesn't reject — e.g., an adapter that swallows
// its own fetch errors and resolves with the cached empty array
// forever) can hold the entire warm cycle hostage. The cycle log
// would show "heavy avg 240000ms" and the next cycle never fires.
// 90 s is generous (heaviest cold cycle observed was ~30 s); a tick
// that exceeds it gets cancelled and we move on to the next city.
const PER_CITY_DEADLINE_MS = 90_000;

async function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T | "_deadline_"> {
  try {
    return await Promise.race<T | "_deadline_">([
      p,
      new Promise<"_deadline_">((resolve) => setTimeout(() => resolve("_deadline_"), ms)),
    ]);
  } catch (err) {
    console.warn(`[warm-worker] ${label} threw:`, (err as Error).message);
    return "_deadline_";
  }
}

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
    withDeadline(crimeData.getCitywide(slug), PER_CITY_DEADLINE_MS, `${slug}/getCitywide`),
    withDeadline(getCitywideSafetyScore(slug), PER_CITY_DEADLINE_MS, `${slug}/safetyScore`),
    withDeadline(getCitywideTrend(slug), PER_CITY_DEADLINE_MS, `${slug}/trend`),
  ]);
  // The withDeadline wrapper resolves with the sentinel "_deadline_"
  // when its inner promise didn't settle in time. Skip the Redis write
  // and let the next cycle try again.
  if (scoreResult.status === "fulfilled" && scoreResult.value && scoreResult.value !== "_deadline_") {
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
    const v = scoreResult.value as { rows?: Array<{ count?: number }>; windowDays?: number };
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

// v96p2 — mid-cycle GC trigger. End-of-cycle GC reclaimed ~125 MB
// but pods still OOMed across multiple cycles because peak heap
// during a cycle's heavy bucket exceeded 3 GB before reclaim. Force
// a major GC AFTER the heavy bucket completes (but before the light
// bucket starts) so the large adapter buffers from the heavy phase
// are released before light cities pile on more. No-op when
// --expose-gc isn't set.
function midCycleGc(): void {
  if (typeof global.gc === "function") {
    global.gc();
  }
}

// v96p2 — heap headroom that forces a cycle to skip and GC instead
// of piling on more adapter buffers. Set well below max-old-space
// (3584 MB) so we have time to drop state before the heap-limit GC
// starts failing to reclaim. Each adapter cache + transient JSON
// parse adds ~50-100 MB during a cycle; skipping when heap is
// already above 2000 MB has been empirically the difference between
// surviving and OOMing 1-2 cycles later.
const HEAP_BACKOFF_MB = 2000;

async function tick() {
  if (inFlight) return; // skip overlap if prior tick is still running
  // v96p2 — skip the cycle when heap is already in the danger zone.
  // Force a major GC right away to drop whatever is dropping-eligible
  // before the next interval fires.
  const heapMB = process.memoryUsage().heapUsed / 1024 / 1024;
  if (heapMB > HEAP_BACKOFF_MB) {
    midCycleGc();
    const afterMB = process.memoryUsage().heapUsed / 1024 / 1024;
    console.log(`[warm-worker] heap-backoff ${Math.round(heapMB)}→${Math.round(afterMB)}MB · skipping cycle`);
    return;
  }
  inFlight = true;
  const cycleStart = Date.now();
  try {
    // v74 — heavy concurrency 4 → 2, light 10 → 5.
    // v96 — production OOM (exit 134 "Ineffective mark-compacts near
    // heap limit") on the post-deploy cold cycle dropped this further
    // to heavy=1, light=3. The cycle now logs heavy avg ~11 s and
    // 14 cities × 1 concurrency = 154 s sequential just for heavy,
    // which is acceptable inside the 4-minute interval. Trading
    // freshness for survivability: peak RSS during a heavy parse is
    // bounded by the single in-flight city's incident buffer
    // (~50–80 MB for LV/LA) instead of 2 × 80 = 160 MB stacked.
    const heavyTimings = await runBatched(HEAVY_CITIES, 1, warmCity);
    // v96p2 — drop heavy-bucket buffers before light bucket starts.
    midCycleGc();
    const lightCities = CITIES.map((c) => c.slug).filter((s) => !HEAVY_CITIES.includes(s));
    const lightTimings = await runBatched(lightCities, 3, warmCity);
    const total = Date.now() - cycleStart;
    const avgHeavy = heavyTimings.length
      ? Math.round(heavyTimings.reduce((a, b) => a + b, 0) / heavyTimings.length)
      : 0;
    const avgLight = lightTimings.length
      ? Math.round(lightTimings.reduce((a, b) => a + b, 0) / lightTimings.length)
      : 0;
    // v96p2 — force a major GC at cycle boundaries so per-page row
    // buffers + transient JSON parses don't accumulate across
    // cycles. Empirically the pod was OOMing on cycle 3-4 because
    // the GC's heuristic wasn't catching up between 4-minute
    // intervals. With `--expose-gc` set in the start command,
    // global.gc() blocks the event loop for a major collection,
    // dropping cumulative resident state back near the steady-
    // state cache size. Log the before/after so the
    // observability surface shows the reclaim.
    const beforeGc = process.memoryUsage().heapUsed;
    if (typeof global.gc === "function") {
      global.gc();
      const afterGc = process.memoryUsage().heapUsed;
      console.log(`[warm-worker] cycle ${total}ms · heavy avg ${avgHeavy}ms · light avg ${avgLight}ms · gc ${Math.round(beforeGc / 1024 / 1024)}→${Math.round(afterGc / 1024 / 1024)}MB`);
    } else {
      console.log(`[warm-worker] cycle ${total}ms · heavy avg ${avgHeavy}ms · light avg ${avgLight}ms · heap ${Math.round(beforeGc / 1024 / 1024)}MB (no --expose-gc)`);
    }
  } catch (err) {
    console.error("[warm-worker] cycle failed:", err);
  } finally {
    inFlight = false;
  }
}

export function startWarmWorker() {
  if (timer) return;
  // v96p2 — WARM_WORKER_ENABLED env gate. Multiple cycles of
  // mitigation (heavy bucket trim 14 → 6, boot tick removed, end-
  // of-cycle GC, mid-cycle GC, heap-aware backoff) reduced but did
  // not eliminate the +15 min OOM. Observation showed GC saturating
  // at ~2.8 GB heap, reclaiming only ~24 MB, then crashing — the
  // adapter buffers are growing faster than the GC heuristic can
  // recover them. Letting the operator disable the worker entirely
  // gives a hard out: pods serve from Redis L2 (warm from prior
  // pods + on-demand fetches by the route handlers when L2 misses),
  // never accumulate the heavy-bucket pressure that drives the OOM.
  // Default `false` because the OOM is now a known regression;
  // operators can flip to `true` once the underlying allocation
  // path is profiled. Cold-start cost for the first request to
  // each city without L2 reverts to the upstream's response time
  // (~5-30 s on the Cleveland/Detroit-class slow path).
  if (process.env.WARM_WORKER_ENABLED !== "true") {
    console.log("[warm-worker] disabled (WARM_WORKER_ENABLED!=true); serving from Redis L2 + on-demand only");
    return;
  }
  console.log(`[warm-worker] starting (cycle every ${WARM_INTERVAL_MS / 1000}s)`);
  // v96 — `void tick()` swallowed any rejection that escaped tick()'s
  // own try/catch (e.g., a Prisma connection drop before the try block).
  // The setInterval keeps firing, but the unhandled rejection is logged
  // by the process-level handler and the user sees no specific signal
  // about which worker is degrading. Explicit .catch on every fire
  // surfaces the worker name in the log line.
  timer = setInterval(() => {
    tick().catch((err) => console.error("[warm-worker] tick threw:", err));
  }, WARM_INTERVAL_MS);
  // v71 followup — fire an initial warm cycle on boot rather than
  // waiting the full 4 min. Pre-v71 the audit caught Cleveland
  // serving 503 warming_up for ~4 min on every container restart.
  // v74 — delay 15s → 30s for /health grace.
  // v96 — bumped 30s → 90s after a post-deploy OOM crashloop.
  // v96p2 — DROPPED ENTIRELY. The boot tick kept putting the pod
  // into an unrecoverable heap pressure window during the cold-
  // start adapter-fetch storm (every adapter populates its own
  // in-process cache, peaks in residency mid-cycle while old data
  // is still GC-rooted, GC can't catch up before allocation
  // failure). The pod now boots clean and serves from Redis L2
  // (warm from the prior pod) for the first 4 minutes; the first
  // scheduled cycle kicks in once memory is settled. Trade-off is
  // ~4 min of staler-than-usual data after a container restart;
  // worth it to stop the crashloop.
}

export function stopWarmWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  inFlight = false;
}
