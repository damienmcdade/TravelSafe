"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCity, STATES, citiesInState } from "@/lib/use-city";
import { WheelPicker, type WheelItem } from "./WheelPicker";

export function CitySelector() {
  const { city, setCity } = useCity();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Local wheel state — committed to global city store only when the user
  // taps "Use this city".
  const [pendingState, setPendingState] = useState<string>(city.state);
  const [pendingCity, setPendingCity]   = useState<string>(city.slug);

  useEffect(() => {
    if (!open) return;
    setPendingState(city.state);
    setPendingCity(city.slug);
  }, [open, city.state, city.slug]);

  // Close on outside click / Escape.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    if (open) {
      document.addEventListener("click", onClick);
      document.addEventListener("keydown", onKey);
    }
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const stateItems: WheelItem[] = useMemo(
    () => STATES.map((s) => ({
      value: s.abbr,
      label: s.label,
      detail: `${s.cities} ${s.cities === 1 ? "city" : "cities"}`,
    })),
    [],
  );

  const cityItems: WheelItem[] = useMemo(() => {
    return citiesInState(pendingState).map((c) => ({
      value: c.slug,
      label: c.label,
      detail: c.status === "live" ? c.source ?? "Official data" : "Coming soon",
      disabled: c.status !== "live",
    }));
  }, [pendingState]);

  // When the state changes, default the pending city to the first LIVE one
  // in that state so the user isn't stuck on a disabled row.
  useEffect(() => {
    const live = citiesInState(pendingState).find((c) => c.status === "live");
    if (live && !cityItems.some((i) => i.value === pendingCity && !i.disabled)) {
      setPendingCity(live.slug);
    }
  }, [pendingState, cityItems, pendingCity]);

  function commit() {
    setCity(pendingCity);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-slate2-700 hover:bg-bay-100 hover:text-bay-700 transition-colors"
        aria-label="Change city"
        aria-expanded={open}
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-bay-500" />
        <span className="font-medium">{city.label}</span>
        <span className="text-slate2-500">·</span>
        <span className="text-slate2-500">{city.state}</span>
        <svg viewBox="0 0 16 16" className="w-3 h-3 opacity-60" fill="none" stroke="currentColor"><path d="M4 6l4 4 4-4" strokeWidth="1.5" /></svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[22rem] surface p-3 z-30 animate-pop-in" onClick={(e) => e.stopPropagation()}>
          <p className="px-1 pt-1 pb-2 text-[10px] uppercase tracking-wider text-slate2-500">
            Scroll the wheels to choose
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate2-500 mb-1 text-center">State</div>
              <WheelPicker
                items={stateItems}
                value={pendingState}
                onChange={setPendingState}
                ariaLabel="State"
                height={196}
                rowHeight={36}
              />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate2-500 mb-1 text-center">City</div>
              <WheelPicker
                items={cityItems}
                value={pendingCity}
                onChange={setPendingCity}
                ariaLabel="City"
                height={196}
                rowHeight={36}
              />
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-[10px] text-slate2-500">Greyed cities are on the roadmap; their data feed isn&apos;t wired up yet.</p>
            <button onClick={commit} className="btn-primary text-xs px-3 py-1.5">Use this city</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Lightweight per-tab notice. Currently every supported city has a working
// feed, so this is a no-op render — kept as an extension point for future
// per-city advisories.
export function CityBanner() {
  return null;
}
