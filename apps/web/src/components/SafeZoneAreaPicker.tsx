"use client";
import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { AreaCombobox } from "./AreaCombobox";

interface Area { slug: string; label: string; jurisdiction: string }

/// Compact type-to-search neighborhood picker used by every SafeZone
/// subtab. Replaces the prior iOS-style wheel — a small search bar takes
/// far less vertical space, autofills from the same `/api/geo/areas`
/// list, and is easier to use for cities with 100+ neighborhoods (the
/// wheel made discovery painful past ~30 rows). Compare flows use the
/// same component, which keeps the primary and compare UIs visually
/// consistent.
export function SafeZoneAreaPicker({
  storageKey,
  onCommit,
  title,
  subtitle,
  commitLabel = "Show this neighborhood",
  autoCommit = true,
  selectedSlug = null,
}: {
  /// Per-tab persistence key namespace (e.g. `safety-score.area`).
  /// Internally we append the city slug so each city gets its own slot.
  storageKey: string;
  onCommit: (area: Area | null) => void;
  title?: string;
  subtitle?: string;
  commitLabel?: string;
  /// When true (default), the picker emits the first available area as soon
  /// as the area list loads so the host page renders content immediately.
  /// Set to false on pages where citywide is the legitimate default state —
  /// the user has to explicitly tap "Show this neighborhood" to drill in.
  autoCommit?: boolean;
  /// Externally-driven selection (e.g. from useArea). When set, the input
  /// shows that label and the picker treats it as the committed value.
  selectedSlug?: string | null;
}) {
  const { city } = useCity();
  const fullKey = `travelsafe.${storageKey}.${city.slug}`;

  // /api/geo/areas?city=<slug> returns the WRAPPED shape
  // `{ areas, stale?, staleMessage? }`. Reading it as Area[] previously
  // crashed every SafeZone subtab via `areas.filter is not a function`.
  interface GeoAreasResp { areas: Area[]; stale?: boolean; staleMessage?: string }
  const areasPath = `/geo/areas?city=${city.slug}`;
  const { data: areasResp, loading: areasLoading, error: areasErr } = useApi<GeoAreasResp>(areasPath, [areasPath]);
  const cityAreas = useMemo(() => {
    const areas = areasResp?.areas ?? [];
    return areas
      .filter((a) => (a?.jurisdiction ?? "").toLowerCase() === city.label.toLowerCase())
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [areasResp, city.label]);

  // `pending` is the user's in-progress pick (typed match, not yet
  // committed). `committed` is what we've already emitted to onCommit.
  const [pending, setPending] = useState<Area | null>(null);
  const [committed, setCommitted] = useState<Area | null>(null);
  const [q, setQ] = useState("");

  // Reset on city switch so a neighborhood from one city doesn't leak
  // into another's combobox.
  useEffect(() => {
    setPending(null);
    setCommitted(null);
    setQ("");
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(fullKey);
      if (stored && cityAreas.length > 0) {
        const match = cityAreas.find((a) => a.slug === stored);
        if (match) {
          setPending(match);
          setQ(match.label);
        }
      }
    } catch { /* ignore */ }
    // We DON'T depend on cityAreas here because that would re-clear the
    // combobox every time the area list refetches. We let the next effect
    // hydrate from storage once areas are ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city.slug, fullKey]);

  // Hydrate from localStorage once areas finish loading (covers the
  // common case where areas resolve AFTER the reset effect above ran).
  useEffect(() => {
    if (pending || cityAreas.length === 0) return;
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(fullKey);
      if (!stored) return;
      const match = cityAreas.find((a) => a.slug === stored);
      if (match) {
        setPending(match);
        setQ(match.label);
      }
    } catch { /* ignore */ }
  }, [cityAreas, fullKey, pending]);

  // Honor an externally-driven selection (e.g. user picked an area in
  // another tab via useArea). Mirror it as the committed value without
  // re-firing onCommit (the parent already knows).
  useEffect(() => {
    if (!selectedSlug) return;
    if (committed?.slug === selectedSlug && pending?.slug === selectedSlug) return;
    if (cityAreas.length === 0) return;
    const match = cityAreas.find((a) => a.slug === selectedSlug);
    if (!match) return;
    setPending(match);
    setCommitted(match);
    setQ(match.label);
  }, [selectedSlug, cityAreas, committed, pending]);

  // Auto-commit the first available area when the picker is configured
  // for it. Used on pages where citywide is NOT the default state.
  useEffect(() => {
    if (!autoCommit) return;
    if (committed) return;
    if (pending) {
      setCommitted(pending);
      onCommit(pending);
      return;
    }
    if (cityAreas.length === 0) return;
    const first = cityAreas[0];
    setPending(first);
    setCommitted(first);
    setQ(first.label);
    onCommit(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCommit, cityAreas, pending, committed]);

  function commit() {
    if (!pending) return;
    setCommitted(pending);
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem(fullKey, pending.slug); } catch { /* ignore */ }
    }
    onCommit(pending);
  }

  return (
    <section className="surface p-4 sm:p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display text-base text-slate2-900">{title ?? `Pick a ${city.label} neighborhood`}</h2>
          <p className="text-xs text-slate2-500 mt-0.5">
            {subtitle ?? `${cityAreas.length} supported neighborhood${cityAreas.length === 1 ? "" : "s"} for ${city.label}.`}
          </p>
        </div>
      </div>

      <div className="mt-3">
        {areasLoading && cityAreas.length === 0 ? (
          <div className="surface-muted p-4 text-center text-sm text-slate2-500 animate-pulse">
            Loading {city.label} neighborhoods…
          </div>
        ) : cityAreas.length === 0 ? (
          <div className="surface-muted p-4 text-center text-sm text-slate2-700">
            {areasErr ? (
              <>
                <p className="font-medium text-slate2-900">Could not reach the {city.label} police feed just now.</p>
                <p className="mt-1.5 text-xs text-slate2-500">Switch tabs or wait ~10 seconds, then come back.</p>
              </>
            ) : (
              <p>No neighborhoods are tracked for {city.label} yet.</p>
            )}
          </div>
        ) : (
          <AreaCombobox
            options={cityAreas}
            value={pending}
            onPick={setPending}
            query={q}
            onQueryChange={setQ}
            scopeLabel={city.label}
            commitLabel={commitLabel}
            committedSlug={committed?.slug ?? null}
            onCommit={commit}
          />
        )}
      </div>
    </section>
  );
}

