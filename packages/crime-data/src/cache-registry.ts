// Central registry of adapter row-cache evictors + a process memory guard.
//
// Every city adapter keeps its fetched rows in a module-level `cache`
// singleton with a ~5-minute freshness TTL. That TTL controls staleness,
// NOT residency: once populated, a city's rows stay on the heap until the
// module is torn down. With 37 adapters each holding tens of thousands of
// Incident objects (DC ~120k, LA ~100k, NYC/Chicago ~50k), the steady
// resident set plus the transient parse spikes from any worker that sweeps
// many cities at once has repeatedly pushed the API past its old-space cap
// and OOM-crashed it (exit 134, "Ineffective mark-compacts near heap
// limit") at ~15 minutes uptime — see apps/api/src/index.ts history.
//
// Each adapter registers a one-line evictor (`() => { cache = null }`) here
// at module load, keyed by its adapter name. A process-level watchdog
// (installed by apps/api) drops retained rows when heapUsed crosses a
// high-water mark so the next GC can reclaim them; adapters transparently
// refetch on the next request.
//
// v99 — LRU eviction. Eviction used to be all-or-nothing: crossing the
// high-water mark dropped EVERY city's cache, so the next request for any
// city (including the one the user is actively viewing) paid a cold
// upstream refetch. Now the dispatcher calls touchRowCache(adapterName)
// whenever it serves a city, and the watchdog evicts the COLD caches first
// (keeping the few hottest cities warm), only escalating to a full eviction
// if that didn't free enough heap. The full-eviction fallback is preserved
// exactly, so the OOM guarantee is unchanged — this only avoids needlessly
// cold-starting the cities people are actually using.

type Evictor = () => void;

interface CacheEntry {
  evict: Evictor;
  /// Adapter name (label) — matches CrimeDataAdapter.name so the dispatcher
  /// can mark a cache "used" by name. Unlabeled registrations get a
  /// synthetic key and are treated as always-cold (evicted first).
  label: string;
  /// Epoch ms of the last time the dispatcher served from this adapter.
  /// 0 = never touched this process (evicted first under pressure).
  lastUsed: number;
}

const entries = new Map<string, CacheEntry>();
let anonSeq = 0;

/// Register an adapter's cache-clear callback. Idempotent per label
/// (Map-keyed); safe to call once at module load. `label` should be the
/// adapter's `name` so touchRowCache() can find it.
export function registerRowCache(evict: Evictor, label?: string): void {
  const key = label ?? `anon-${anonSeq++}`;
  const existing = entries.get(key);
  // Preserve lastUsed across a re-registration (shouldn't happen, but keeps
  // hot-ness stable if a module is somehow re-evaluated).
  entries.set(key, { evict, label: key, lastUsed: existing?.lastUsed ?? 0 });
}

/// Mark an adapter's cache as just-used so LRU eviction keeps it warm.
/// No-op for an unknown label (e.g. an adapter that didn't register one).
export function touchRowCache(label: string): void {
  const e = entries.get(label);
  if (e) e.lastUsed = Date.now();
}

/// Drop every registered adapter cache. Returns the number cleared.
/// Never throws — a misbehaving evictor can't block the rest. This is the
/// OOM safety fallback; behavior is identical to the pre-v99 watchdog.
export function evictAllRowCaches(): number {
  let n = 0;
  for (const e of entries.values()) {
    try { e.evict(); e.lastUsed = 0; n++; } catch { /* best-effort */ }
  }
  return n;
}

/// Evict all but the `keepHot` most-recently-used caches. Returns the count
/// evicted. Used as the first, gentler phase of the memory watchdog so the
/// cities currently in use stay warm; the watchdog falls back to
/// evictAllRowCaches() if this doesn't free enough heap.
export function evictColdRowCaches(keepHot: number): number {
  if (keepHot <= 0) return evictAllRowCaches();
  const sorted = [...entries.values()].sort((a, b) => b.lastUsed - a.lastUsed);
  const cold = sorted.slice(keepHot);
  let n = 0;
  for (const e of cold) {
    try { e.evict(); e.lastUsed = 0; n++; } catch { /* best-effort */ }
  }
  return n;
}

/// Count of registered caches (diagnostics / health payload).
export function registeredRowCacheCount(): number {
  return entries.size;
}

// Re-exported here so apps/api can pull all process-memory-guard telemetry
// (cache eviction + heavy-compose concurrency) from one subpath for the
// /health payload. The limiter itself lives in lib/compute-limit.ts.
export { computeLimitStats } from "./lib/compute-limit.js";
