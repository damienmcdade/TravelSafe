"use client";
import { useEffect, useRef, useState } from "react";
import { useCity, STATES, citiesInState } from "@/lib/use-city";
import { WheelCityAreaPicker } from "./WheelCityAreaPicker";

// Shared selector-pill styling. Used by both CitySelector and the
// StateSelector below so the two controls are visually identical.
// Padding tightens on mobile so the pill fits in narrow headers
// without clipping. min-w-0 + max-w-[60vw] guards against
// pathological label widths from cities with long names.
const TRIGGER_CLS = "inline-flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-sm bg-white border border-bay-200 text-slate2-900 shadow-card hover:bg-bay-50 hover:border-bay-400 hover:shadow-glow-bay transition-all min-w-0 max-w-[60vw] sm:max-w-none";

/// Header city switcher. Two modes share one dropdown:
///
///   1. Search-first (default open state): a single combobox the user
///      types into. Matches the same combobox UX we ship on Safe Route
///      and SafeZone, scaled for 30 cities. Arrow keys + Enter commit.
///
///   2. Browse-by-state (collapsible disclosure): the original
///      state + city wheels for users who don't know which city to
///      pick and want to scroll geographically. Kept because some
///      users find browsing faster than typing for short city lists.
///
/// Search is the default because typing "det" is far faster than
/// finding Michigan → Detroit on two wheels — the wheel UX was
/// painful past the SD/LA/SF starter set.
export function CitySelector() {
  const { city, setCity } = useCity();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Close on outside click / Escape. On Escape, return focus to the
  // trigger button so keyboard users land back on a recognizable
  // affordance rather than nowhere (WCAG focus-management).
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    if (open) {
      document.addEventListener("click", onClick);
      document.addEventListener("keydown", onKey);
    }
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(slug: string) {
    setCity(slug);
    setOpen(false);
    // Return focus to the trigger after pick so the user can continue
    // with keyboard nav from a known location.
    triggerRef.current?.focus();
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={TRIGGER_CLS}
        aria-label={`Change city — currently ${city.label}, ${city.state}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {/* Location-pin icon — clearly signals "this is your selected
            place" rather than the prior tiny dot. */}
        <svg viewBox="0 0 16 16" className="w-4 h-4 text-bay-700 shrink-0" fill="currentColor" aria-hidden>
          <path d="M8 1a5 5 0 0 0-5 5c0 3.5 5 9 5 9s5-5.5 5-9a5 5 0 0 0-5-5zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/>
        </svg>
        <span className="flex items-baseline gap-1.5 min-w-0">
          {/* "City" prefix label hidden on mobile to save horizontal
              real-estate — the icon already signals "this is a place
              picker". Label truncates instead of breaking the
              container. */}
          <span className="hidden sm:inline text-[11px] uppercase tracking-wider text-slate2-500 shrink-0">City</span>
          <span className="font-semibold truncate">{city.label}</span>
        </span>
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 text-slate2-500 shrink-0" fill="none" stroke="currentColor" aria-hidden>
          <path d="M4 6l4 4 4-4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Change city and neighborhood"
          // Wider than the prior 22rem dropdown so two wheels fit
          // comfortably side-by-side on desktop; collapses to
          // viewport-1rem on mobile so it never overflows.
          className="absolute right-0 mt-2 w-[28rem] max-w-[calc(100vw-1rem)] surface p-3 z-30 animate-pop-in"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="px-1 pb-2 text-[11px] uppercase tracking-wider text-slate2-500">
            Pick a city + neighborhood
          </p>
          {/* Wheel picker stays open across wheel changes — the user
              commits via the in-picker button which closes the dropdown
              via the onCommit callback. Replaces the prior search +
              browse-by-state UX which closed the dropdown immediately
              on city pick (forcing the user back out before they could
              pick a neighborhood). */}
          <WheelCityAreaPicker compact onCommit={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}


/// State selector — sibling pill to CitySelector, identical visual
/// treatment. Clicking opens a state list (with city counts); picking
/// a state switches the city to the first live city in that state.
/// Renders nothing if the current city's state has no peers (i.e.,
/// it's the only city in its state) — the control would just be
/// noise in that case.
export function StateSelector() {
  const { city, setCity } = useCity();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    }
    if (open) {
      document.addEventListener("click", onClick);
      document.addEventListener("keydown", onKey);
    }
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pickState(abbr: string) {
    if (abbr === city.state) { setOpen(false); return; }
    // Switch to the first LIVE city in the chosen state. If none, fall
    // back to the first city regardless of status so the dropdown
    // doesn't appear to no-op.
    const peers = citiesInState(abbr);
    const target = peers.find((c) => c.status === "live") ?? peers[0];
    if (target) setCity(target.slug);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={TRIGGER_CLS}
        aria-label={`Change state — currently ${city.stateLabel}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {/* Region / flag-like icon — visually distinguishable from
            the city pin while keeping the same visual weight. */}
        <svg viewBox="0 0 16 16" className="w-4 h-4 text-bay-700 shrink-0" fill="currentColor" aria-hidden>
          <path d="M3 2v12h1.5V9l3.5 1.2c.5.2 1 0 1.3-.4l2.2-3.2c.3-.5.1-1.2-.5-1.4L7.5 3.8V2H3zm1.5 1.5h1.5v1.7l3.7 1.4-1.6 2.4L4.5 8V3.5z"/>
        </svg>
        <span className="flex items-baseline gap-1.5">
          <span className="text-[11px] uppercase tracking-wider text-slate2-500">State</span>
          <span className="font-semibold">{city.state}</span>
        </span>
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 text-slate2-500" fill="none" stroke="currentColor" aria-hidden>
          <path d="M4 6l4 4 4-4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Change state"
          className="absolute right-0 mt-2 w-[16rem] surface p-2 z-30 animate-pop-in"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="px-2 pt-1 pb-2 text-[11px] uppercase tracking-wider text-slate2-500">
            Jump to a state
          </p>
          <ul role="listbox" aria-label="States" className="max-h-72 overflow-auto divide-y divide-sand-100 rounded-lg border border-sand-200">
            {STATES.map((s) => {
              const isCurrent = s.abbr === city.state;
              return (
                <li key={s.abbr}>
                  <button
                    type="button"
                    onClick={() => pickState(s.abbr)}
                    className={`w-full flex items-baseline justify-between gap-2 px-3 py-2 text-sm text-left transition-colors ${
                      isCurrent ? "bg-bay-100 text-slate2-900 font-medium" : "hover:bg-sand-100 text-slate2-900"
                    }`}
                    role="option"
                    aria-selected={isCurrent}
                  >
                    <span className="truncate">
                      {s.label}
                      {isCurrent && <span className="ml-1.5 text-[11px] text-bay-700">· current</span>}
                    </span>
                    <span className="text-[11px] uppercase tracking-wider text-slate2-500 shrink-0">
                      {s.cities} {s.cities === 1 ? "city" : "cities"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
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
