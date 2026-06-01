// Global concurrency gate for heavy whole-city composes.
//
// The memory watchdog (apps/api/src/index.ts) bounds the RESIDENT row-cache
// baseline well, but it polls on a fixed interval — so a BURST of concurrent
// COLD city composes can spike heap past the old-space cap *between* polls and
// OOM-crash the process (exit 134) before the watchdog can evict. Each cold
// compose parses one city's full incident set (DC ~120k, LA ~100k, NYC/Chicago
// ~50k Incident objects) and fans out a Promise.all over every neighborhood;
// N of them running at once allocates N transient copies simultaneously.
//
// `dedupe()` (lib/inflight.ts) already collapses concurrent calls for the SAME
// (city, endpoint) onto one promise, but it can't bound DISTINCT cities/
// endpoints. This semaphore does: at most `max` heavy composes run
// concurrently; the rest queue and start as permits free. The trade is a small
// queueing delay under a pathological multi-city burst (a scraper, or a
// fan-out sweep) instead of a crash — the same "latency blip, not a crash"
// posture as the watchdog. Peak transient heap is bounded regardless of poll
// timing.
//
// SAFETY: only the six dedupe-wrapped citywide composers are gated
// (getCitywide / area-stats / safety-score / trend / mix / upticks). Their
// bodies call ONLY leaf ops (getIncidents / getAreaStats), never another
// composer, so there is no gate-within-gate — the semaphore cannot deadlock.
// Per-area leaf reads stay ungated, so single-area request latency is
// unaffected.

// Tunable without a redeploy. Default 4: enough that a normal same-city first
// paint (7 endpoints share one warm adapter cache after the first parse) isn't
// meaningfully slowed, low enough that a 38-city sweep can't stack 38 cold
// parses at once. Clamped to >=1.
const MAX = (() => {
  const raw = Number(process.env.COMPUTE_CONCURRENCY);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 4;
})();

let active = 0;
const waiters: Array<() => void> = [];

/// Run `fn` under the global heavy-compose semaphore. Resolves/rejects with
/// fn's result; a rejection still releases the permit. Never throws
/// synchronously.
export function withComputeLimit<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      active++;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          active--;
          waiters.shift()?.();
        });
    };
    if (active < MAX) start();
    else waiters.push(start);
  });
}

/// Diagnostics for the /health payload.
export function computeLimitStats(): { max: number; active: number; queued: number } {
  return { max: MAX, active, queued: waiters.length };
}
