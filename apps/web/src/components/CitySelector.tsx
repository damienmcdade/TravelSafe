"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCity, STATES, citiesInState, CITIES, type CityInfo } from "@/lib/use-city";
import { WheelPicker, type WheelItem } from "./WheelPicker";

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
        <div
          className="absolute right-0 mt-2 w-[22rem] surface p-3 z-30 animate-pop-in"
          onClick={(e) => e.stopPropagation()}
        >
          <CitySearchCombobox currentSlug={city.slug} onPick={pick} />
          <BrowseByStateDisclosure currentCity={city} onPick={pick} />
        </div>
      )}
    </div>
  );
}

/// Search-first combobox. Filters CITIES by label substring. Arrow keys
/// move focus, Enter commits the focused match. Disabled (coming-soon)
/// cities render greyed-out and are not selectable. Auto-focuses on
/// open so the user can start typing immediately.
function CitySearchCombobox({
  currentSlug,
  onPick,
}: {
  currentSlug: string;
  onPick: (slug: string) => void;
}) {
  const [q, setQ] = useState("");
  const [focusIdx, setFocusIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = [...CITIES].sort((a, b) => a.label.localeCompare(b.label));
    if (!needle) return all;
    return all.filter((c) =>
      c.label.toLowerCase().includes(needle) ||
      c.stateLabel.toLowerCase().includes(needle) ||
      c.state.toLowerCase() === needle,
    );
  }, [q]);

  // Keep focus index inside the matches range.
  useEffect(() => { setFocusIdx(0); }, [q]);

  function commit(c: CityInfo) {
    if (c.status !== "live") return;
    onPick(c.slug);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = matches[focusIdx];
      if (m) commit(m);
    }
  }

  // Stable ids for WAI-ARIA combobox linkage. Single instance per
  // CitySelector so a constant id works.
  const listboxId = "city-quick-search-listbox";
  const optionId = (slug: string) => `city-quick-search-opt-${slug}`;
  const activeOption = matches[focusIdx];
  return (
    <div>
      <p className="px-1 pt-1 pb-2 text-[10px] uppercase tracking-wider text-slate2-500">
        Jump to a city
      </p>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={`Search ${CITIES.length} cities…`}
        className="input text-sm"
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded
        aria-controls={listboxId}
        aria-activedescendant={activeOption ? optionId(activeOption.slug) : undefined}
        aria-label="Search cities"
      />
      <ul
        id={listboxId}
        className="mt-2 max-h-72 overflow-auto rounded-lg border border-sand-200 divide-y divide-sand-100"
        role="listbox"
        aria-label="Cities"
      >
        {matches.length === 0 && (
          <li className="px-3 py-3 text-xs text-slate2-500">
            No city matches &ldquo;{q}&rdquo;. Try a state name or abbreviation.
          </li>
        )}
        {matches.map((c, i) => {
          const isCurrent = c.slug === currentSlug;
          const isLive = c.status === "live";
          return (
            <li key={c.slug}>
              <button
                type="button"
                id={optionId(c.slug)}
                onMouseEnter={() => setFocusIdx(i)}
                onMouseDown={(e) => { e.preventDefault(); commit(c); }}
                disabled={!isLive}
                className={`w-full flex items-baseline justify-between gap-2 px-3 py-2 text-sm text-left transition-colors ${
                  !isLive ? "text-slate2-500 cursor-not-allowed bg-sand-50/40" :
                  i === focusIdx ? "bg-bay-100 text-slate2-900" :
                  isCurrent ? "bg-bay-50 text-slate2-900" :
                  "hover:bg-sand-100 text-slate2-900"
                }`}
                role="option"
                aria-selected={i === focusIdx}
                aria-disabled={!isLive}
              >
                <span className="truncate">
                  {c.label}
                  {isCurrent && <span className="ml-1.5 text-[10px] text-bay-700">· current</span>}
                  {!isLive && <span className="ml-1.5 text-[10px]">· coming soon</span>}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-slate2-500 shrink-0">{c.state}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/// Collapsible disclosure that exposes the original two-wheel browse
/// UX. Default-closed because search beats wheels for most users on
/// a 30-city list.
function BrowseByStateDisclosure({
  currentCity,
  onPick,
}: {
  currentCity: CityInfo;
  onPick: (slug: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pendingState, setPendingState] = useState<string>(currentCity.state);
  const [pendingCity, setPendingCity]   = useState<string>(currentCity.slug);

  useEffect(() => {
    setPendingState(currentCity.state);
    setPendingCity(currentCity.slug);
  }, [currentCity.state, currentCity.slug]);

  const pendingIsLive = useMemo(
    () => CITIES.find((c) => c.slug === pendingCity)?.status === "live",
    [pendingCity],
  );

  const stateItems: WheelItem[] = useMemo(
    () => STATES.map((s) => ({
      value: s.abbr,
      label: s.label,
      detail: `${s.cities} ${s.cities === 1 ? "city" : "cities"}`,
    })),
    [],
  );

  const cityItems: WheelItem[] = useMemo(
    () => citiesInState(pendingState).map((c) => ({
      value: c.slug,
      label: c.label,
      detail: c.status === "live" ? c.source ?? "Official data" : "Coming soon",
      disabled: c.status !== "live",
    })),
    [pendingState],
  );

  // When the state changes, default the pending city to the first LIVE
  // one in that state so the user isn't stuck on a disabled row.
  useEffect(() => {
    const live = citiesInState(pendingState).find((c) => c.status === "live");
    if (live && !cityItems.some((i) => i.value === pendingCity && !i.disabled)) {
      setPendingCity(live.slug);
    }
  }, [pendingState, cityItems, pendingCity]);

  return (
    <div className="mt-3 pt-3 border-t border-sand-200">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="w-full flex items-center justify-between px-1 py-1 text-xs text-slate2-700 hover:text-bay-700 transition-colors"
        aria-expanded={expanded}
      >
        <span>{expanded ? "− Hide" : "+ Browse by state"}</span>
        <span className="text-[10px] text-slate2-500">
          {STATES.length} states · {CITIES.length} cities
        </span>
      </button>

      {expanded && (
        <div className="mt-2 animate-pop-in">
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
                searchable
                searchPlaceholder="State"
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
                searchable
                searchPlaceholder="City"
              />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-[10px] text-slate2-500 max-w-[60%]">
              {pendingIsLive
                ? "Greyed cities are on the roadmap; their data feed isn't wired up yet."
                : "This city is on the roadmap — its police data feed isn't wired up yet."}
            </p>
            <button
              onClick={() => onPick(pendingCity)}
              disabled={!pendingIsLive}
              className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {pendingIsLive ? "Use this city" : "Coming soon"}
            </button>
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
