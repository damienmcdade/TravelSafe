"use client";
import { useCallback, useEffect, useState } from "react";

// Shared "how far back am I looking?" preference. CrimeChart, TrendPanel,
// and any future window-aware card read/write the same key so picking
// "Last 90 days" on one surface is reflected when the user scrolls to
// the next. Picks were previously per-component, which produced the
// jarring effect of seeing 90-day data in one card and 30-day data in
// the next without realizing the windows had drifted.
const STORAGE_KEY = "travelsafe.window.v2";
// Legacy key from the era when only CrimeChart had a persistent window.
// We read it once on first hydration so users who already saved a
// preference don't lose it; subsequent reads/writes use STORAGE_KEY.
const LEGACY_KEY = "travelsafe.crime-chart.window.v1";

/// All values are days. "all" is a sentinel meaning "no window — every
/// cached incident". Cards that don't support "all" must snap to their
/// nearest supported value via `snapToSupported`.
export type WindowValue = number | "all";

const DEFAULT: WindowValue = 30;

function parseStored(raw: string | null): WindowValue | null {
  if (raw == null) return null;
  if (raw === "all") return "all";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function readInitial(): WindowValue {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const v2 = parseStored(window.localStorage.getItem(STORAGE_KEY));
    if (v2 != null) return v2;
    const v1 = parseStored(window.localStorage.getItem(LEGACY_KEY));
    if (v1 != null) {
      // Promote legacy value into the new key so subsequent reads are
      // consistent. Don't delete the legacy key — privacy dashboard
      // surfaces it, and users may have multiple tabs open on the
      // old code path during the rollout.
      try { window.localStorage.setItem(STORAGE_KEY, String(v1)); } catch { /* ignore */ }
      return v1;
    }
    return DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/// useTimeWindow returns the current preference plus a setter that
/// persists it to localStorage and broadcasts to other useTimeWindow
/// subscribers in the same tab via a custom event.
///
/// Different cards can offer different preset lists (CrimeChart goes
/// out to 365 days + "all"; TrendPanel maxes at 90). When the shared
/// value isn't in a card's preset list, the card should call
/// `snapToSupported` to find the nearest supported value to render —
/// it still shows the user's preference, just snapped to the card's
/// own granularity. The shared store itself is NOT snapped — the
/// user's actual chosen value is preserved so when they navigate
/// back to a card that does support it, the original value comes
/// back.
const EVENT_NAME = "travelsafe:time-window-change";

export function useTimeWindow(): {
  value: WindowValue;
  setValue: (v: WindowValue) => void;
} {
  const [value, setLocal] = useState<WindowValue>(DEFAULT);

  // Hydrate from storage on mount — SSR returns DEFAULT.
  useEffect(() => { setLocal(readInitial()); }, []);

  // Listen for changes broadcast by other hook instances in this tab.
  useEffect(() => {
    function onChange(e: Event) {
      const v = (e as CustomEvent<WindowValue>).detail;
      if (v != null) setLocal(v);
    }
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      const next = parseStored(e.newValue);
      if (next != null) setLocal(next);
    }
    window.addEventListener(EVENT_NAME, onChange as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT_NAME, onChange as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setValue = useCallback((v: WindowValue) => {
    setLocal(v);
    try { window.localStorage.setItem(STORAGE_KEY, String(v)); } catch { /* ignore */ }
    try { window.dispatchEvent(new CustomEvent<WindowValue>(EVENT_NAME, { detail: v })); } catch { /* ignore */ }
  }, []);

  return { value, setValue };
}

/// Snap an arbitrary window value to the nearest supported value in a
/// card's preset list. "all" is preserved if present; otherwise it
/// falls back to the largest numeric preset (closest semantic match).
export function snapToSupported(value: WindowValue, presets: ReadonlyArray<WindowValue>): WindowValue {
  if (value === "all") {
    if (presets.includes("all")) return "all";
    const numerics = presets.filter((p): p is number => typeof p === "number");
    return numerics.length ? Math.max(...numerics) : DEFAULT;
  }
  const numerics = presets.filter((p): p is number => typeof p === "number");
  if (numerics.length === 0) return value;
  let nearest = numerics[0];
  let bestDelta = Math.abs(nearest - value);
  for (const n of numerics) {
    const d = Math.abs(n - value);
    if (d < bestDelta) { nearest = n; bestDelta = d; }
  }
  return nearest;
}
