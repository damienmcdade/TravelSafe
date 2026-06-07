import type { Incident } from "../types.js";
import { registerRowCache } from "../cache-registry.js";

// v108 — shared tiered cold-load helper. Several heavy ArcGIS adapters
// (Atlanta/Charlotte/Indy/LV got this hand-rolled in v107; Detroit in v108)
// share the exact same cold-start failure: on a cold cache they blocked on the
// FULL multi-page pull (30-45 pages, 30-60s) before returning anything, so the
// first request after a pod restart / while the warm worker is behind lost the
// ~45s route-timeout race and served empty. The fix is always the same shape:
//
//   1. fetch the most-recent RECENT_PAGES first (feeds are ordered date DESC),
//      cache + serve them within a few seconds → current activity + the area
//      list are immediately available,
//   2. backfill the remaining pages in the BACKGROUND, dedup-merge by incident
//      id, and upgrade the cache to the full-depth dataset used for grading.
//
// The recent tier is a valid recent WINDOW (not a silently-truncated full
// pull), so its annualized rate — counts ÷ windowDays — stays representative
// for grading until the deep tier widens the window. Adapters whose cache is a
// plain { fetchedAt, rows } and whose read paths all funnel through getRows()
// can delegate the whole tier/dedup/deepen/cache/in-flight-dedup dance here and
// keep only their fetchPage + row mapping.

export interface TieredLoaderOptions {
  /** Adapter name — used as the cache-registry eviction key and in log lines. */
  name: string;
  /** Tier-1 page count served fast on a cold cache. */
  recentPages: number;
  /** Full-depth page count backfilled in the background. */
  pages: number;
  /**
   * Fetch the half-open page range [startPage, endPage). MUST map to Incident[]
   * and report `complete=false` if any page in the range errored (so a partial
   * deep pull isn't promoted to the full-depth baseline). Implement with the
   * adapter's own fetchPage + row mapping; pass a stable baseIndex into the row
   * mapper so id-less rows stay unique across ranges (dedup correctness).
   */
  fetchRange: (startPage: number, endPage: number) => Promise<{ rows: Incident[]; complete: boolean }>;
  /** Row-cache TTL. Default 5 minutes (matches every adapter). */
  ttlMs?: number;
}

export interface TieredLoader {
  /** Tiered cold-load + cache read. Concurrent callers share one in-flight pull. */
  getRows(): Promise<Incident[]>;
  /** Currently-cached rows without triggering a fetch (or null when cold). */
  peek(): Incident[] | null;
}

export function createTieredLoader(opts: TieredLoaderOptions): TieredLoader {
  const ttl = opts.ttlMs ?? 5 * 60 * 1000;
  const tiered = opts.recentPages > 0 && opts.recentPages < opts.pages;
  let cache: { fetchedAt: number; rows: Incident[]; full: boolean } | null = null;
  // In-flight fetch dedup (the OOM-guard Detroit added in v94): the dispatcher
  // fans a per-area Promise.all over every neighbourhood, so a cold cache would
  // otherwise fire N concurrent full fetches, each allocating its own row
  // buffer. Concurrent callers now await the SAME promise.
  let inFlight: Promise<Incident[]> | null = null;
  let deepening = false;
  registerRowCache(() => { cache = null; }, opts.name);

  async function deepen(recent: Incident[]): Promise<void> {
    if (deepening) return;
    deepening = true;
    try {
      const { rows: rest, complete } = await opts.fetchRange(opts.recentPages, opts.pages);
      if (rest.length === 0) return;  // nothing gained; keep the recent tier as-is
      const byId = new Map<string, Incident>();
      for (const r of recent) byId.set(r.id, r);
      for (const r of rest) if (!byId.has(r.id)) byId.set(r.id, r);
      // Only mark `full` when the deep pull was COMPLETE. A partial deep pull
      // under-counts uniformly and would mis-grade; we still cache the merged
      // rows (strictly more than the recent tier) but leave full=false so the
      // next TTL lapse re-attempts a complete backfill.
      cache = { fetchedAt: Date.now(), rows: Array.from(byId.values()), full: complete };
    } catch (err) {
      console.warn(`[${opts.name}] deepen failed:`, (err as Error).message);
    } finally {
      deepening = false;
    }
  }

  async function getRows(): Promise<Incident[]> {
    const now = Date.now();
    if (cache && cache.rows.length > 0 && now - cache.fetchedAt < ttl) return cache.rows;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        // Non-tiered (recentPages>=pages or 0): a single full pull, no deepen.
        const firstEnd = tiered ? opts.recentPages : opts.pages;
        const { rows: recent, complete } = await opts.fetchRange(0, firstEnd);
        if (recent.length > 0) {
          cache = { fetchedAt: now, rows: recent, full: tiered ? false : complete };
          if (tiered) void deepen(recent);
          return recent;
        }
        return cache?.rows ?? [];
      } catch (err) {
        console.warn(`[${opts.name}] fetch failed:`, (err as Error).message);
        return cache?.rows ?? [];
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return { getRows, peek: () => cache?.rows ?? null };
}
