"use client";
import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { WheelPicker, type WheelItem } from "./WheelPicker";

interface Area { slug: string; label: string; jurisdiction: string }

/// Rotating-wheel neighborhood picker used by every SafeZone subtab.
/// Filters /api/geo/areas down to the currently-selected city, persists
/// the user's last pick per city to localStorage, and emits the committed
/// pick to the parent via `onCommit`. The wheel only shows neighborhoods
/// TravelSafe actually tracks for the selected city.
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
  /// Externally-driven selection (e.g. from useArea). When set, the wheel
  /// jumps to that slug and marks it as committed so the picker visually
  /// reflects a global neighborhood pick from another tab.
  selectedSlug?: string | null;
}) {
  const { city } = useCity();
  const fullKey = `travelsafe.${storageKey}.${city.slug}`;
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [committedSlug, setCommittedSlug] = useState<string | null>(null);

  const areasPath = `/geo/areas?city=${city.slug}`;
  const { data: areas, loading: areasLoading, error: areasErr } = useApi<Area[]>(areasPath, [areasPath]);
  const cityAreas = useMemo(() => {
    if (!areas) return [];
    return areas
      .filter((a) => a.jurisdiction.toLowerCase() === city.label.toLowerCase())
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [areas, city.label]);

  useEffect(() => {
    setCommittedSlug(null);
    setPendingSlug(null);
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(fullKey);
      if (stored) setPendingSlug(stored);
    } catch { /* ignore */ }
  }, [city.slug, fullKey]);

  useEffect(() => {
    if (pendingSlug || cityAreas.length === 0) return;
    setPendingSlug(cityAreas[0].slug);
  }, [pendingSlug, cityAreas]);

  // Honor an externally-driven selection (e.g. user picked an area in
  // another tab via useArea). Jump the wheel to that slug AND mark it as
  // committed so the page renders for that area without a re-tap.
  useEffect(() => {
    if (!selectedSlug) return;
    if (selectedSlug === committedSlug && selectedSlug === pendingSlug) return;
    if (cityAreas.length === 0) return;
    if (!cityAreas.find((a) => a.slug === selectedSlug)) return;
    setPendingSlug(selectedSlug);
    setCommittedSlug(selectedSlug);
  }, [selectedSlug, cityAreas, committedSlug, pendingSlug]);

  function commit() {
    if (!pendingSlug) return;
    const area = cityAreas.find((a) => a.slug === pendingSlug) ?? null;
    setCommittedSlug(pendingSlug);
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem(fullKey, pendingSlug); } catch { /* ignore */ }
    }
    onCommit(area);
  }

  // Auto-commit the first time areas load so subtabs render something
  // immediately without forcing the user to push a button. Pages that
  // have a meaningful citywide default opt out via autoCommit={false}.
  useEffect(() => {
    if (!autoCommit) return;
    if (committedSlug || !pendingSlug || cityAreas.length === 0) return;
    const exists = cityAreas.find((a) => a.slug === pendingSlug);
    if (exists) {
      setCommittedSlug(pendingSlug);
      onCommit(exists);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityAreas.length, pendingSlug, committedSlug, autoCommit]);

  const wheelItems: WheelItem[] = useMemo(
    () => cityAreas.map((a) => ({ value: a.slug, label: a.label, detail: city.label })),
    [cityAreas, city.label],
  );

  return (
    <section className="surface p-4 sm:p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display text-base text-slate2-900">{title ?? `Pick a ${city.label} neighborhood`}</h2>
          <p className="text-xs text-slate2-500 mt-0.5">
            {subtitle ?? `${cityAreas.length} supported neighborhood${cityAreas.length === 1 ? "" : "s"} for ${city.label}.`}
          </p>
        </div>
        <button
          onClick={commit}
          disabled={!pendingSlug || pendingSlug === committedSlug}
          className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {committedSlug === pendingSlug && committedSlug ? "Showing" : commitLabel}
        </button>
      </div>

      <div className="mt-3">
        {areasLoading ? (
          <div className="surface-muted p-6 text-center text-sm text-slate2-500 animate-pulse">
            Loading {city.label} neighborhoods…
          </div>
        ) : cityAreas.length === 0 ? (
          <div className="surface-muted p-6 text-center text-sm text-slate2-700">
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
          <WheelPicker
            items={wheelItems}
            value={pendingSlug ?? wheelItems[0]?.value ?? ""}
            onChange={setPendingSlug}
            ariaLabel={`Neighborhoods in ${city.label}`}
            height={196}
            rowHeight={36}
            searchable
            searchPlaceholder={`Search ${city.label} neighborhoods`}
          />
        )}
      </div>
    </section>
  );
}
