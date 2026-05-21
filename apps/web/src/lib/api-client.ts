"use client";
import { useCallback, useEffect, useState } from "react";

// Same-origin: every API call hits the Next.js Route Handlers under /api/*
// served by the same Vercel deployment as the web app. NEXT_PUBLIC_API_BASE_URL
// can still override (e.g. local dev pointing at a different host).
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "";

// Default client-side periodic refresh — 10 minutes, matched to the server
// cache TTL on the police data adapters so the user always sees the freshest
// upstream data without hammering it.
const DEFAULT_REFRESH_MS = 10 * 60 * 1000;

function token(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("travelsafe.token");
}

export function setToken(t: string | null) {
  if (typeof window === "undefined") return;
  if (t == null) localStorage.removeItem("travelsafe.token");
  else localStorage.setItem("travelsafe.token", t);
}

export function isSignedIn(): boolean {
  return token() != null;
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(init.headers ?? {}),
  };
  const tk = token();
  if (tk) (headers as Record<string, string>).Authorization = `Bearer ${tk}`;
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
  /** Auto-refresh interval in ms. Pass `false` to disable; default 10 minutes. */
  refreshIntervalMs?: number | false;
}

/// React hook that surfaces fetch errors directly. Re-fetches on mount, on
/// dependency change, on tab focus (to catch users returning after lunch),
/// and on a configurable interval (default 10 minutes — matched to the
/// server cache TTL on the police data adapters).
export function useApi<T = unknown>(
  path: string | null,
  deps: unknown[] = [],
  opts: UseApiOptions = {},
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const d = await api<T>(path);
      setData(d);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

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

  // Refresh whenever the user brings the tab back into focus.
  useEffect(() => {
    function onVisible() {
      if (typeof document !== "undefined" && !document.hidden) void reload();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  return { data, error, loading, reload };
}
