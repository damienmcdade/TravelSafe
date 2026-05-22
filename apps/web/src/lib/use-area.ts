"use client";
import { useCallback, useSyncExternalStore } from "react";

/// The minimal area shape every tab agrees on. Pages that need more (the
/// Safe Route page uses a centroid) re-look up the slug against their own
/// loaded area list — this keeps the global store free of stale lat/lng
/// when adapters update polygon centers.
export interface AreaSelection {
  slug: string;
  label: string;
  jurisdiction: string;
}

const STORAGE_KEY = "travelsafe.area.v1";

// Per-city storage so switching cities doesn't carry over a neighborhood
// that doesn't exist in the new city's adapter. The picked area for each
// city is remembered separately; returning to a city restores its pick.
type Store = Record<string, AreaSelection | null>;

const listeners = new Set<() => void>();
let store: Store | null = null;

// Per-city snapshot cache. useSyncExternalStore demands stable references
// for the same data (otherwise it re-renders endlessly), so we memoize
// each citySlug's last-returned value and only rebuild when it changes.
const snapshotByCity = new Map<string, AreaSelection | null>();

function load(): Store {
  if (store) return store;
  if (typeof window === "undefined") { store = {}; return store; }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    store = raw ? (JSON.parse(raw) as Store) : {};
    // Seed the snapshot cache so the first getSnapshot() call for each
    // city returns the same reference the broadcaster will compare against.
    for (const [k, v] of Object.entries(store)) snapshotByCity.set(k, v ?? null);
  } catch {
    store = {};
  }
  return store;
}

function save(next: Store) {
  store = next;
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* quota — ignore */ }
  }
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}

function getSnapshot(citySlug: string): AreaSelection | null {
  const s = load();
  const fresh = s[citySlug] ?? null;
  const prev = snapshotByCity.get(citySlug);
  // Same reference if nothing changed — keeps useSyncExternalStore stable
  // and prevents render storms. Two different objects with identical
  // contents are NOT considered equal here on purpose: every setArea()
  // produces a new AreaSelection, which is the canonical "data changed"
  // signal.
  if (prev !== undefined && prev === fresh) return prev;
  snapshotByCity.set(citySlug, fresh);
  return fresh;
}

// Server snapshot is always null — SSR has no localStorage. This satisfies
// React's hydration contract: the server-rendered HTML and the first
// client render agree on null, then useSyncExternalStore swaps in the
// stored value on the post-hydration commit.
function getServerSnapshot(): AreaSelection | null {
  return null;
}

/// Globally-shared neighborhood selection, keyed by city slug. Picking a
/// neighborhood in any tab calls setArea() — every other consumer of
/// useArea(citySlug) re-renders with the same selection. Backed by
/// useSyncExternalStore so SSR hydration is clean (no hydration warnings)
/// and all subscribers always read the same value.
export function useArea(citySlug: string) {
  const area = useSyncExternalStore(
    subscribe,
    () => getSnapshot(citySlug),
    getServerSnapshot,
  );

  const setArea = useCallback((next: AreaSelection | null) => {
    const s = { ...load() };
    if (next == null) delete s[citySlug];
    else s[citySlug] = { slug: next.slug, label: next.label, jurisdiction: next.jurisdiction };
    save(s);
    // Invalidate this city's memoized snapshot so the next getSnapshot()
    // returns the new value. Every subscriber's callback then runs and
    // useSyncExternalStore reconciles them.
    snapshotByCity.delete(citySlug);
    for (const cb of listeners) cb();
  }, [citySlug]);

  return { area, setArea };
}
