"use client";
import { useCallback, useEffect, useState } from "react";
import { sampleFor } from "./sample-data";

// Same-origin: every API call hits the Next.js Route Handlers under /api/*
// served by the same Vercel deployment as the web app. NEXT_PUBLIC_API_BASE_URL
// can still override (e.g. local dev pointing at a different host).
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "";

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

// Tiny pub-sub so the UI can show a "demo data" banner the first time we
// fall through to bundled samples.
let demoModeActive = false;
const demoListeners = new Set<(active: boolean) => void>();
function markDemoMode() {
  if (demoModeActive) return;
  demoModeActive = true;
  for (const cb of demoListeners) cb(true);
}
export function isDemoModeActive(): boolean { return demoModeActive; }
export function subscribeDemoMode(cb: (active: boolean) => void) {
  demoListeners.add(cb);
  return () => demoListeners.delete(cb);
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

/// React hook with built-in fallback to bundled sample data when the API
/// can't be reached. Read endpoints always render something — write endpoints
/// (POST/PUT/DELETE via api()) still surface their original errors.
export function useApi<T = unknown>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const [usingSample, setUsingSample] = useState(false);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const d = await api<T>(path);
      setData(d);
      setUsingSample(false);
    } catch (e) {
      const sample = sampleFor(path);
      if (sample !== undefined) {
        setData(sample as T);
        setUsingSample(true);
        markDemoMode();
      } else {
        setError(e as Error);
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  return { data, error, loading, reload, usingSample };
}
