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

// fix(audit pentest-authn-4): the session JWT no longer lives in localStorage
// (any XSS could read it there). It now rides in an HttpOnly `cs_session` cookie
// the server sets, which JS cannot read. localStorage keeps only a NON-sensitive
// presence marker so the client still knows whether to bootstrap a session.
//
// LEGACY_TOKEN_KEY is the pre-migration localStorage JWT. A returning user still
// has one; on their next load we send it as a Bearer once (ensureAnonymousAuth →
// /auth/anonymous), the server re-issues the SAME user's session into the cookie,
// and we then delete the legacy JWT. After that the cookie is the sole credential.
const LEGACY_TOKEN_KEY = "travelsafe.token";
const PRESENCE_KEY = "travelsafe.session.v2";

function legacyToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LEGACY_TOKEN_KEY);
}

function hasSession(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(PRESENCE_KEY) === "1" || legacyToken() != null;
}

// v68 — exposed for callers that inject a Bearer token into a streaming fetch
// (the api() wrapper consumes the body so can't be reused for SSE). Post-
// migration this returns null and the stream relies on the same-origin cookie;
// during migration it returns the legacy JWT so the stream still authenticates.
export function getStoredToken(): string | null { return legacyToken(); }

/// Record/clear the local session state. We deliberately do NOT persist the JWT
/// — the cookie holds it. Passing a token marks "session present" and retires any
/// legacy localStorage JWT (its job is done once the cookie is set). Passing null
/// is a full local sign-out.
export function setToken(t: string | null) {
  if (typeof window === "undefined") return;
  if (t == null) {
    localStorage.removeItem(PRESENCE_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } else {
    localStorage.setItem(PRESENCE_KEY, "1");
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  }
}

export function isSignedIn(): boolean {
  return hasSession();
}

// fix(audit auth-no-revocation-web-2): server-side logout bumps tokenVersion
// (revoking the token + any leaked copy) and clears the HttpOnly cookie. We then
// drop the local presence marker regardless of network outcome.
export async function logout(): Promise<void> {
  try {
    await rawApi("/auth/logout", { method: "POST" });
  } catch {
    /* clear locally regardless */
  } finally {
    setToken(null);
  }
}

/// Silently establish a per-device session on first visit (and migrate returning
/// localStorage sessions onto the cookie). A no-op once the presence marker is
/// set. Safe to call from a useEffect on app mount.
let bootstrapPromise: Promise<void> | null = null;
export async function ensureAnonymousAuth(): Promise<void> {
  if (typeof window === "undefined") return;
  // Marker present → the cookie is already established; nothing to do. (A bare
  // legacy token with no marker still falls through so we migrate it.)
  if (localStorage.getItem(PRESENCE_KEY) === "1") return;
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    try {
      // rawApi adds the legacy Bearer if one exists, so the server reuses the
      // SAME user (preserving their data) and plants the cookie; a brand-new
      // device gets a fresh anonymous session + cookie. Either way the response
      // body carries a token we use only to flip the presence marker.
      const body = await rawApi<{ token?: string }>("/auth/anonymous", { method: "POST", body: "{}" });
      if (body?.token) setToken(body.token);
    } catch {
      // Silently fail — the user can still browse public data; we retry on the
      // next mount via the hook below.
    } finally {
      bootstrapPromise = null;
    }
  })();
  return bootstrapPromise;
}

/// React hook: kicks off bootstrap on mount and returns a tri-state.
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
  // Anon-auth race: bootstrap establishes the session (cookie) in a useEffect,
  // but auth-gated panels (AreaBriefPanel, AIAssistant, ThreatFeed's row
  // explainer) mount in the same render tick and their first fetch can fire
  // before the cookie lands — they'd get a 401 and useApi locks into an error
  // state. Wait the bootstrap out here so the first call is never session-less.
  // Idempotent + cached, so this adds at most one ~150ms wait on first nav.
  if (!hasSession() && typeof window !== "undefined" && !path.startsWith("/auth/")) {
    await ensureAnonymousAuth();
  }
  // fix(audit pentest-authn-4): the HttpOnly cookie is the credential and rides
  // same-origin automatically. We only attach a Bearer header for a LEGACY
  // localStorage token that hasn't migrated yet (and for native callers); once
  // migrated, legacyToken() is null and auth is cookie-only.
  const lt = legacyToken();
  if (lt) (headers as Record<string, string>).Authorization = `Bearer ${lt}`;
  // credentials:'include' so the session cookie is sent (same-origin already
  // would, but this is explicit + survives a cross-origin NEXT_PUBLIC_API_BASE_URL).
  // init.signal already flows through to fetch() via the spread — callers that
  // pass an AbortSignal will see the underlying fetch cancel on .abort().
  const res = await fetch(`${API_BASE}/api${path}`, { credentials: "include", ...init, headers });
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

// v103 — cold-cache cities return a friendly warming 503 (`upstream_timeout`
// from /crime-data/citywide, `warming_up` from /safezone/safety-score) while
// the adapter populates its row cache in the background and the next request
// lands warm. Pre-v103 useApi surfaced that as a hard error, stranding the
// Crime Map / score on an error surface until the user manually reloaded.
// We now auto-retry those two specific errors a bounded number of times with
// backoff so the page recovers on its own. Bounded (not infinite) so a feed
// that's genuinely down still surfaces the error instead of retry-storming.
const WARMING_ERROR_RE = /upstream_timeout|warming_up/i;
const WARMING_MAX_RETRIES = 4;
const WARMING_BACKOFF_MS = [2000, 3000, 5000, 8000];

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
  // fix(audit hydration): start null on BOTH server and the first client render
  // so they agree (no React #418). swrRead() reads localStorage — server-null but
  // client-populated — so seeding it in the useState initializer made the first
  // client render diverge from the SSR HTML. The mount/path-change effect below
  // already restores the SWR cache synchronously (the "instant stale data" UX is
  // unchanged), just one tick later, after hydration completes.
  const [data, setData] = useState<T | null>(null);
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
  // Bounded auto-retry state for cold-cache "warming" 503s (see WARMING_* above).
  const warmRetryRef = useRef(0);
  const warmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    if (!path) return;
    // Cancel any previous request before starting a new one.
    abortRef.current?.abort();
    if (warmTimerRef.current != null) { clearTimeout(warmTimerRef.current); warmTimerRef.current = null; }
    const controller = new AbortController();
    abortRef.current = controller;
    const myVersion = ++versionRef.current;
    // Don't flip loading on if we have cached data — UI shows the cached
    // response while we revalidate quietly behind the scenes.
    const hasCached = swrMs > 0 && swrRead<T>(path, swrMs) != null;
    if (!hasCached) setLoading(true);
    setError(null);
    // When set, we've scheduled a warming retry and must NOT clear the loading
    // skeleton in `finally` — keep it up through the backoff so the UI shows
    // "still loading" rather than an empty/no-data flash.
    let scheduledWarmRetry = false;
    try {
      const d = await api<T>(path, { signal: controller.signal });
      if (myVersion !== versionRef.current) return; // stale — newer request superseded us
      setData(d);
      warmRetryRef.current = 0; // recovered — reset the warming budget
      if (swrMs > 0) swrWrite<T>(path, d);
    } catch (e) {
      // Suppress aborts entirely — they happen when the user navigates or
      // rapidly switches selection. Not an error condition.
      if ((e as { name?: string })?.name === "AbortError") return;
      if (myVersion !== versionRef.current) return; // stale errors also dropped
      // Cold-cache warming 503 → retry a few times with backoff instead of
      // stranding the user; the background warm + retry usually lands data.
      if (WARMING_ERROR_RE.test((e as Error)?.message ?? "") && warmRetryRef.current < WARMING_MAX_RETRIES) {
        const delay = WARMING_BACKOFF_MS[Math.min(warmRetryRef.current, WARMING_BACKOFF_MS.length - 1)];
        warmRetryRef.current += 1;
        scheduledWarmRetry = true;
        warmTimerRef.current = setTimeout(() => { void reload(); }, delay);
        return;
      }
      warmRetryRef.current = 0;
      setError(e as Error);
    } finally {
      if (myVersion === versionRef.current && !scheduledWarmRetry) setLoading(false);
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
    return () => { versionRef.current++; abortRef.current?.abort(); if (warmTimerRef.current != null) clearTimeout(warmTimerRef.current); };
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
