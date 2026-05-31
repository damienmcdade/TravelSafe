"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Same-origin: every API call hits the Next.js Route Handlers under /api/*
// served by the same Vercel deployment as the web app. NEXT_PUBLIC_API_BASE_URL
// can still override (e.g. local dev pointing at a different host).
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "";

// Default client-side periodic refresh — 10 minutes, matched to the server
// cache TTL on the police data adapters so the user always sees the freshest
// upstream data without hammering it.
// Background refresh cadence for useApi consumers. 15 minutes aligns with the
// Awareness tab's product requirement to "refresh content every 15 minutes"
// and is comfortably above the 5-min server cache on every police adapter —
// so each refresh has a meaningful chance of picking up new incidents
// without hammering the upstream open-data feeds.
const DEFAULT_REFRESH_MS = 15 * 60 * 1000;

function token(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("travelsafe.token");
}

// v68 — exposed for callers that need to inject the Bearer token into
// a streaming fetch (the api() wrapper consumes the response body so
// can't be used for SSE / readable-stream responses like the AI
// assistant chat). Consumers should also `await ensureAnonymousAuth()`
// before reading to avoid a tokenless first request.
export function getStoredToken(): string | null { return token(); }

export function setToken(t: string | null) {
  if (typeof window === "undefined") return;
  if (t == null) localStorage.removeItem("travelsafe.token");
  else localStorage.setItem("travelsafe.token", t);
}

export function isSignedIn(): boolean {
  return token() != null;
}

/// Silently mint (and persist) a per-device anonymous session on first visit
/// so every feature works without a visible login flow. Subsequent calls are
/// a no-op once a token is stored. Safe to call from a useEffect on app mount.
let bootstrapPromise: Promise<void> | null = null;
export async function ensureAnonymousAuth(): Promise<void> {
  if (typeof window === "undefined") return;
  if (token()) return;
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/anonymous`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) return;
      const body = await res.json();
      if (body?.token) setToken(body.token);
    } catch {
      // Silently fail — the user can still browse public data. We retry on the
      // next mount via the same hook below.
    } finally {
      bootstrapPromise = null;
    }
  })();
  return bootstrapPromise;
}

/// React hook: kicks off anonymous bootstrap on mount and returns a tri-state.
export function useAnonymousAuth(): { ready: boolean } {
  const [ready, setReady] = useState<boolean>(() => typeof window !== "undefined" && isSignedIn());
  useEffect(() => {
    if (ready) return;
    void ensureAnonymousAuth().then(() => setReady(isSignedIn()));
  }, [ready]);
  return { ready };
}

// v99 — in-flight GET dedup. The SWR localStorage cache only helps across
// mounts/reloads; on a single page-paint several components request the
// same path concurrently (e.g. /city fires /safezone/trend 3× and
// /official-alerts 3×), and on a cold cache every one missed and fired its
// own browser→Vercel→Railway round-trip. Collapsing concurrent identical
// GETs onto one promise removes those redundant hops. Keyed by path; the
// entry clears as soon as the request settles, so SWR/refresh still control
// when the next real fetch happens. The shared request intentionally drops
// any single caller's AbortSignal (one component unmounting must not cancel
// the fetch the others are awaiting); useApi's version guard already
// discards stale results, so correctness is unaffected.
const inflightGets = new Map<string, Promise<unknown>>();

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET") return rawApi<T>(path, init);
  const existing = inflightGets.get(path);
  if (existing) return existing as Promise<T>;
  const p = rawApi<T>(path, { ...init, signal: undefined }).finally(() => {
    inflightGets.delete(path);
  });
  inflightGets.set(path, p);
  return p as Promise<T>;
}

async function rawApi<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(init.headers ?? {}),
  };
  // Anon-auth race: SessionBootstrap mints the device token in a
  // useEffect, but auth-gated panels (AreaBriefPanel, AIAssistant,
  // ThreatFeed's row explainer) mount in the same render tick and
  // their first fetch fires before the token lands — they get a 401
  // and the useApi hook locks in an error state with no token-change
  // signal to re-trigger. Wait the bootstrap out here so the first
  // call is never tokenless. Idempotent + cached, so this adds at
  // most one ~150ms wait on the very first navigation.
  let tk = token();
  if (!tk && typeof window !== "undefined" && !path.startsWith("/auth/")) {
    await ensureAnonymousAuth();
    tk = token();
  }
  if (tk) (headers as Record<string, string>).Authorization = `Bearer ${tk}`;
  // init.signal already flows through to fetch() via the spread — callers
  // that pass an AbortSignal will see the underlying fetch cancel when
  // .abort() is called, freeing the network slot before the response
  // arrives.
  const res = await fetch(`${API_BASE}/api${path}`, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = (body && (body.error || body.message)) || `http_${res.status}`;
    const err = new Error(message) as Error & { status: number; body: unknown };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body as T;
}

export interface UseApiOptions {
  /** Auto-refresh interval in ms. Pass `false` to disable; default 15 minutes. */
  refreshIntervalMs?: number | false;
  /** Persist responses to localStorage with this freshness window, in ms.
   *  When set, the hook returns cached data instantly on mount and quietly
   *  revalidates in the background. Pass `false` to disable persistence.
   *  Default: 15 minutes for any GET — matches the upstream cache lifetime
   *  on the police adapters so panning a map or returning to a tab doesn't
   *  re-pay the cold-fetch tax. */
  staleWhileRevalidateMs?: number | false;
}

const SWR_DEFAULT_MS = 15 * 60 * 1000;
const SWR_KEY_PREFIX = "travelsafe.swr.v1.";

interface SwrEntry<T> { fetchedAt: number; data: T }

function swrRead<T>(path: string, ttlMs: number): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SWR_KEY_PREFIX + path);
    if (!raw) return null;
    const e = JSON.parse(raw) as SwrEntry<T>;
    if (!e || typeof e.fetchedAt !== "number") return null;
    if (Date.now() - e.fetchedAt > ttlMs) return null;
    return e.data;
  } catch {
    return null;
  }
}

function swrWrite<T>(path: string, data: T) {
  if (typeof window === "undefined") return;
  // Guard against accidental "null"-keyed entries when a caller passes a
  // nullable path that briefly resolved to null. Without this, the cache
  // would accumulate `travelsafe.swr.v1.null` entries and eat quota.
  if (!path || path === "null") return;
  try {
    // Drop oldest entries if we ever blow the 5MB localStorage budget.
    // We don't run a periodic GC — clearing on quota error is enough.
    window.localStorage.setItem(SWR_KEY_PREFIX + path, JSON.stringify({ fetchedAt: Date.now(), data }));
  } catch {
    // QuotaExceededError: drop every CommunitySafe SWR entry and try once more.
    try {
      const toDelete: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(SWR_KEY_PREFIX)) toDelete.push(k);
      }
      for (const k of toDelete) window.localStorage.removeItem(k);
      window.localStorage.setItem(SWR_KEY_PREFIX + path, JSON.stringify({ fetchedAt: Date.now(), data }));
    } catch { /* give up */ }
  }
}

/// React hook that surfaces fetch errors directly. On mount it serves a
/// stale-cached response immediately (if available within the SWR window),
/// then revalidates in the background. Also refetches on dependency change,
/// on tab focus (to catch users returning after lunch), and on a configurable
/// interval (default 15 minutes — matched to the server cache TTL on the
/// police data adapters).
export function useApi<T = unknown>(
  path: string | null,
  deps: unknown[] = [],
  opts: UseApiOptions = {},
) {
  const swrMs = opts.staleWhileRevalidateMs === false ? 0 : (opts.staleWhileRevalidateMs ?? SWR_DEFAULT_MS);
  const [data, setData] = useState<T | null>(() => path && swrMs > 0 ? swrRead<T>(path, swrMs) : null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  // Track the latest in-flight request so a slow stale response can't
  // overwrite a fresh one when the user rapidly switches city / area.
  // Each useEffect run bumps the version; only the matching version's
  // resolved data is committed to state. We also hold onto the latest
  // AbortController so the network request itself can be cancelled —
  // version-ref alone drops the result client-side, but the bytes still
  // travel. Aborting frees the connection and saves bandwidth on rapid
  // dep changes (e.g. someone scrubbing through cities).
  const versionRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    if (!path) return;
    // Cancel any previous request before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const myVersion = ++versionRef.current;
    // Don't flip loading on if we have cached data — UI shows the cached
    // response while we revalidate quietly behind the scenes.
    const hasCached = swrMs > 0 && swrRead<T>(path, swrMs) != null;
    if (!hasCached) setLoading(true);
    setError(null);
    try {
      const d = await api<T>(path, { signal: controller.signal });
      if (myVersion !== versionRef.current) return; // stale — newer request superseded us
      setData(d);
      if (swrMs > 0) swrWrite<T>(path, d);
    } catch (e) {
      // Suppress aborts entirely — they happen when the user navigates or
      // rapidly switches selection. Not an error condition.
      if ((e as { name?: string })?.name === "AbortError") return;
      if (myVersion !== versionRef.current) return; // stale errors also dropped
      setError(e as Error);
    } finally {
      if (myVersion === versionRef.current) setLoading(false);
    }
     
  }, [path, swrMs]);

  useEffect(() => {
    if (!path) { setData(null); return; }
    // Restore from SWR cache the moment the path changes so the UI flashes
    // the prior city/area immediately instead of skeleton-loading.
    if (swrMs > 0) {
      const cached = swrRead<T>(path, swrMs);
      if (cached != null) setData(cached);
    }
    void reload();
    // Bump version on unmount/dep-change AND abort any pending fetch.
    // The "versionRef.current may change by cleanup time" warning is
    // the intended behavior — bumping the version is precisely how
    // we mark prior in-flight responses as stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { versionRef.current++; abortRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, swrMs, ...deps]);

  // Periodic background refresh.
  useEffect(() => {
    if (!path) return;
    const ms = opts.refreshIntervalMs === false ? 0 : (opts.refreshIntervalMs ?? DEFAULT_REFRESH_MS);
    if (!ms) return;
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void reload();
    }, ms);
    return () => window.clearInterval(id);
  }, [path, opts.refreshIntervalMs, reload]);

  // Refresh whenever the user brings the tab back into focus — but only
  // if the cached response has actually gone stale. v99: previously this
  // unconditionally re-fired every hook on every tab return, so flipping
  // away and back re-pulled the whole page (including the heavy trend
  // payloads) even if the data was seconds old. Gate on the SWR window so
  // a quick tab-switch is free.
  useEffect(() => {
    function onVisible() {
      if (typeof document === "undefined" || document.hidden || !path) return;
      // No SWR persistence (swrMs<=0) → keep the old always-refresh behavior.
      if (swrMs > 0 && swrRead<T>(path, swrMs) != null) return; // still fresh
      void reload();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload, path, swrMs]);

  return { data, error, loading, reload };
}
