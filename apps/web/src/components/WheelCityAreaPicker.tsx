"use client";
import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useCity, CITIES, STATES, citiesInState } from "@/lib/use-city";
import { useArea } from "@/lib/use-area";
import { WheelPicker, type WheelItem } from "./WheelPicker";

interface AreaRow { slug: string; label: string; jurisdiction: string }
interface AreasResp { areas: AreaRow[]; stale?: boolean }

/// Three-wheel State + City + Neighborhood picker. v45 rebuild —
/// previously the StateSelector pill and CitySelector pill were
/// separate, and picking a state in the State dropdown auto-jumped
/// to the FIRST city in that state with no way to pick a different
/// city without then opening the separate City dropdown — users
/// described it as "the state selector locks me out of picking a
/// city". This unified picker:
///
///   - shows ALL THREE wheels side-by-side (or stacked on mobile)
///   - picking a state filters the city wheel to that state's cities
///   - picking a city filters the neighborhood wheel to that city's areas
///   - each wheel auto-commits on settle (v23 behavior, kept)
///   - the global useCity / useArea stores update incrementally so
///     the rest of the app stays in sync as the user navigates
///
/// `onCommit` (optional) — fires after a neighborhood commits.
/// Header dropdowns use this to close themselves so the commit flow
/// feels intentional.
///
/// `compact` (optional) — stacks the wheels vertically and trims
/// spacing for tight surfaces like the header dropdown.
export function WheelCityAreaPicker({
  onCommit,
  compact = false,
}: {
  onCommit?: () => void;
  compact?: boolean;
} = {}) {
  const { city, setCity } = useCity();
  const { area, setArea } = useArea(city.slug);

  // Pending state and pending city are local so the user can scrub
  // the wheels (state → filters cities → filters neighborhoods)
  // without each scroll-tick blowing away the in-progress selection.
  // The global stores commit on actual wheel settle (handleStateChange
  // / handleCityChange call setCity), not on every render.
  const [pendingState, setPendingState] = useState<string>(city.state);
  const [pendingCity, setPendingCity] = useState<string>(city.slug);

  useEffect(() => { setPendingState(city.state); setPendingCity(city.slug); }, [city.state, city.slug]);

  const pendingCityInfo = CITIES.find((c) => c.slug === pendingCity) ?? city;
  const citiesInPendingState = useMemo(() => citiesInState(pendingState), [pendingState]);

  // Areas list for the PENDING city.
  const areasPath = `/geo/areas?city=${pendingCity}`;
  const { data: areasResp, loading: areasLoading } = useApi<AreasResp>(areasPath, [areasPath]);
  const cityAreas = useMemo(() => {
    const areas = areasResp?.areas ?? [];
    return areas
      .filter((a) => (a?.jurisdiction ?? "").toLowerCase() === pendingCityInfo.label.toLowerCase())
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [areasResp, pendingCityInfo.label]);

  // STATE wheel — picking a state filters the city wheel but does
  // NOT yet commit a city to the global store (the user might still
  // want to pick a specific city within that state). Only when a
  // city is picked does setCity fire.
  function handleStateChange(abbr: string) {
    setPendingState(abbr);
    // If the current pending city isn't in the newly-picked state,
    // pre-select the first LIVE city of the new state so the city
    // wheel lands on something valid. Don't commit globally yet.
    if (pendingCityInfo.state !== abbr) {
      const peers = citiesInState(abbr);
      const target = peers.find((c) => c.status === "live") ?? peers[0];
      if (target) setPendingCity(target.slug);
    }
  }

  // CITY wheel — picking a city commits to the global useCity store
  // so the rest of the app refreshes. We DON'T auto-jump areas
  // here; the area wheel's useEffect below handles defaulting to
  // the first area of the new city if the current area is wrong.
  function handleCityChange(slug: string) {
    setPendingCity(slug);
    if (slug !== city.slug) setCity(slug);
  }

  // Auto-commit the first area of a new city once the area list
  // loads, so users who picked a city never see "no area selected"
  // downstream. Only fires when the current area doesn't belong to
  // the now-selected city.
  useEffect(() => {
    if (cityAreas.length === 0) return;
    const current = area?.slug ?? null;
    if (current && cityAreas.some((a) => a.slug === current)) return;
    const first = cityAreas[0];
    setArea({ slug: first.slug, label: first.label, jurisdiction: first.jurisdiction });
  }, [cityAreas, area?.slug, setArea]);

  function handleAreaChange(slug: string) {
    const picked = cityAreas.find((a) => a.slug === slug);
    if (!picked) return;
    setArea({ slug: picked.slug, label: picked.label, jurisdiction: picked.jurisdiction });
    // v46 — do NOT call onCommit() here. The wheel's onChange fires
    // on every scroll-settle, including transient stops as the user
    // scrubs through a long neighborhood list. Previously each
    // intermediate stop closed the dropdown, locking the user out
    // before they reached their target. Now the global useArea
    // store still updates immediately (so /neighborhood + /map
    // refresh in real time), but the dropdown stays open until
    // the user explicitly closes it via outside-click or Escape.
  }

  // Wheel items.
  const stateItems: WheelItem[] = useMemo(
    () => STATES.map((s) => ({
      value: s.abbr,
      label: s.label,
      detail: `${s.cities} ${s.cities === 1 ? "city" : "cities"}`,
    })),
    [],
  );

  const cityItems: WheelItem[] = useMemo(
    () => [...citiesInPendingState]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((c) => ({
        value: c.slug,
        label: c.label,
        detail: c.status === "coming-soon" ? "Coming soon" : undefined,
        disabled: c.status !== "live",
      })),
    [citiesInPendingState],
  );

  const areaItems: WheelItem[] = useMemo(
    () => cityAreas.map((a) => ({
      value: a.slug,
      label: a.label,
      detail: undefined,
    })),
    [cityAreas],
  );

  const wheelHeight = compact ? 180 : 220;
  const wheelRow    = compact ? 36  : 40;
  // 3-column on wide screens; 1-column stacks on mobile + compact.
  const gridCls = compact
    ? "grid grid-cols-1 sm:grid-cols-3 gap-2"
    : "grid grid-cols-1 sm:grid-cols-3 gap-3";

  const body = (
    <>
      <div className={gridCls}>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate2-500 mb-1 text-center">State</div>
          <WheelPicker
            items={stateItems}
            value={pendingState}
            onChange={handleStateChange}
            ariaLabel="State"
            height={wheelHeight}
            rowHeight={wheelRow}
            searchable
            searchPlaceholder="State"
          />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate2-500 mb-1 text-center">City</div>
          {cityItems.length === 0 ? (
            <div style={{ height: wheelHeight }} className="flex items-center justify-center text-xs text-slate2-500 px-2 text-center">
              No supported cities in this state yet.
            </div>
          ) : (
            <WheelPicker
              items={cityItems}
              value={pendingCity}
              onChange={handleCityChange}
              ariaLabel="City"
              height={wheelHeight}
              rowHeight={wheelRow}
              searchable
              searchPlaceholder="City"
            />
          )}
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate2-500 mb-1 text-center">Neighborhood</div>
          {areasLoading && areaItems.length === 0 ? (
            <div style={{ height: wheelHeight }} className="flex items-center justify-center text-xs text-slate2-500 animate-pulse">
              Loading {pendingCityInfo.label} neighborhoods…
            </div>
          ) : areaItems.length === 0 ? (
            <div style={{ height: wheelHeight }} className="flex items-center justify-center text-xs text-slate2-500">
              No neighborhoods loaded for {pendingCityInfo.label}.
            </div>
          ) : (
            <WheelPicker
              items={areaItems}
              value={area?.slug ?? areaItems[0]?.value ?? ""}
              onChange={handleAreaChange}
              ariaLabel="Neighborhood"
              height={wheelHeight}
              rowHeight={wheelRow}
              searchable
              searchPlaceholder="Neighborhood"
            />
          )}
        </div>
      </div>

      <div className={`mt-3 flex items-center justify-between gap-2 flex-wrap ${compact ? "text-[11px]" : ""}`}>
        <p className={`text-[11px] text-slate2-500 ${compact ? "text-[10px]" : ""}`}>
          Each wheel updates the page as you settle. Tap done when finished.
        </p>
        {onCommit && (
          <button
            type="button"
            onClick={() => onCommit()}
            className="btn-primary text-sm px-3 py-1.5"
          >
            Done
          </button>
        )}
      </div>
    </>
  );

  if (compact) return <div>{body}</div>;

  return (
    <section className="surface p-4 sm:p-5">
      <header className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
        <div>
          <h3 className="font-display text-lg text-slate2-900">Pick a state, city + neighborhood</h3>
          <p className="text-xs text-slate2-500 mt-0.5">
            Spin the wheels to select. Each commit narrows the next list automatically.
          </p>
        </div>
      </header>
      {body}
    </section>
  );
}
