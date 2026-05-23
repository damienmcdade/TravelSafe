"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";

interface Area { slug: string; label: string; jurisdiction: string }
interface LookupResult { area: Area; matchedVia: "exact" | "zip" | "fuzzy" | "geocode"; rawQuery: string }

export function LocationSearch({
  onResolved,
  current,
  placeholder,
}: {
  onResolved: (area: Area | null) => void;
  current?: Area | null;
  placeholder?: string;
}) {
  const { city } = useCity();
  const { data: areas } = useApi<Area[]>("/geo/areas");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const [status, setStatus] = useState<"idle" | "looking" | "found" | "miss" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset the query when the city changes so the autocomplete restarts clean.
  useEffect(() => { setQ(""); setStatus("idle"); setError(null); setOpen(false); }, [city.slug]);

  // Mirror the externally-provided `current` selection into the input. This
  // matters when the area was picked in another tab via the global useArea
  // store — when the user lands here, the search should already show the
  // active neighborhood, not an empty box.
  useEffect(() => {
    if (current && current.label !== q) {
      setQ(current.label);
      setStatus("found");
      setOpen(false);
      setError(null);
    } else if (!current && status === "found") {
      // The selection was cleared elsewhere; wipe the input so the user
      // isn't looking at a stale label.
      setQ("");
      setStatus("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.slug]);

  // Close the dropdown on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open]);

  // Compute autocomplete suggestions. Filter the known-areas list locally —
  // current city's matches first, then up to 3 from other cities so users can
  // discover the multi-city scope without leaving the input.
  const suggestions = useMemo(() => {
    if (!areas || q.trim().length < 1) return [];
    const needle = q.toLowerCase().trim();
    const matches = areas.filter((a) => a.label.toLowerCase().includes(needle) || a.slug.toLowerCase().includes(needle));
    const inCity = matches.filter((a) => a.jurisdiction.toLowerCase() === city.label.toLowerCase());
    const other  = matches.filter((a) => a.jurisdiction.toLowerCase() !== city.label.toLowerCase());
    // Sort each group: exact-prefix matches first, then alpha.
    const rank = (a: Area) => (a.label.toLowerCase().startsWith(needle) ? 0 : 1);
    inCity.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
    other.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
    return [...inCity.slice(0, 7), ...other.slice(0, 3)];
  }, [areas, q, city.label]);

  // Every neighborhood in the active city, alphabetized — the strip below
  // becomes a horizontally-scrollable browse rail so the user can flick
  // through ALL options without typing. Combined with the typing autofill
  // dropdown above, the input supports three interaction styles in one
  // surface: free-text Enter (geo lookup), autofill picker, and scroll
  // browse.
  const quickPicks = useMemo(() => {
    if (!areas) return [];
    return areas
      .filter((a) => a.jurisdiction.toLowerCase() === city.label.toLowerCase())
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [areas, city.label]);

  async function lookup(query: string) {
    setStatus("looking");
    setError(null);
    try {
      const r = await api<LookupResult>(`/geo/lookup?q=${encodeURIComponent(query)}`);
      onResolved(r.area);
      setStatus("found");
      setOpen(false);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 404) {
        setStatus("miss");
        setError(`Couldn't match "${query}" to a known neighborhood. Try a ZIP code or a major area name.`);
      } else {
        setStatus("error");
        setError(err.message);
      }
    }
  }

  function pickArea(area: Area) {
    setQ(area.label);
    setStatus("found");
    setOpen(false);
    onResolved(area);
  }

  function onChange(v: string) {
    setQ(v);
    setError(null);
    setFocusIdx(0);
    if (v.trim().length === 0) {
      setStatus("idle");
      setOpen(false);
      return;
    }
    setOpen(true);
    setStatus("idle");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      if (e.key === "Enter" && q.trim()) {
        e.preventDefault();
        void lookup(q.trim());
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = suggestions[focusIdx];
      if (pick) pickArea(pick);
      else if (q.trim()) void lookup(q.trim());
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function clear() {
    setQ("");
    setStatus("idle");
    setError(null);
    setOpen(false);
    onResolved(null);
    inputRef.current?.focus();
  }

  return (
    <div ref={wrapRef} className="surface p-4 relative">
      <label htmlFor="location-search-input" className="text-sm text-slate2-700">Show me</label>
      <div className="mt-1 flex gap-2">
        <input
          id="location-search-input"
          ref={inputRef}
          value={q}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => q.trim().length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? `Search a ${city.label} neighborhood, ZIP, or landmark`}
          className="flex-1 input"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="location-search-listbox"
          aria-activedescendant={open && suggestions[focusIdx] ? `loc-opt-${suggestions[focusIdx].slug}` : undefined}
        />
        {current && (
          <button
            onClick={clear}
            className="btn-ghost text-xs"
            aria-label={`Clear search and return to ${city.label} citywide view`}
          >
            ← {city.label}
          </button>
        )}
      </div>

      {/* Dropdown ---------------------------------------------------- */}
      {open && suggestions.length > 0 && (
        <ul
          id="location-search-listbox"
          role="listbox"
          aria-label="Matching neighborhoods"
          className="absolute left-4 right-4 mt-1 surface shadow-card-lift z-30 max-h-72 overflow-auto animate-pop-in p-1"
        >
          {suggestions.map((s, i) => {
            const inCity = s.jurisdiction.toLowerCase() === city.label.toLowerCase();
            return (
              <li key={s.slug} role="option" id={`loc-opt-${s.slug}`} aria-selected={i === focusIdx}>
                <button
                  onMouseEnter={() => setFocusIdx(i)}
                  onClick={() => pickArea(s)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2 transition-colors ${
                    i === focusIdx ? "bg-bay-100 text-slate2-900" : "hover:bg-sand-100 text-slate2-900"
                  }`}
                >
                  <span>
                    <span className="font-medium">{s.label}</span>
                    {!inCity && <span className="ml-2 text-[10px] uppercase tracking-wider text-coral-700">{s.jurisdiction}</span>}
                  </span>
                  {inCity ? (
                    <span className="text-[10px] text-slate2-500">in {city.label}</span>
                  ) : (
                    <span className="text-[10px] text-slate2-500">different city</span>
                  )}
                </button>
              </li>
            );
          })}
          <li className="px-3 py-2 text-[10px] text-slate2-500 border-t border-sand-200">
            Press Enter to search the API for an exact match. Esc to close.
          </li>
        </ul>
      )}

      <div className="mt-2 text-xs h-4">
        {status === "looking" && <span className="text-slate2-500 animate-pulse">Looking up…</span>}
        {status === "found"   && current && <span className="text-sage-700">→ {current.label}</span>}
        {status === "miss"    && <span className="text-amber2-700">{error}</span>}
        {status === "error"   && <span className="text-dusk-700">{error}</span>}
      </div>

      {/* Browse strip when the input is empty — horizontally scrollable
          list of every {city.label} neighborhood. Acts as the third
          interaction style alongside typing autofill (above) and free-text
          Enter (also above). The current `current` pick is highlighted so
          users can see where they are. */}
      {q.trim().length === 0 && quickPicks.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] uppercase tracking-wider text-slate2-500 mb-1.5">
            Browse {city.label} ({quickPicks.length}) — type above to filter
          </p>
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 [scrollbar-width:thin]">
            {quickPicks.map((a) => {
              const active = current?.slug === a.slug;
              return (
                <button
                  key={a.slug}
                  onClick={() => pickArea(a)}
                  className={`shrink-0 text-xs px-2.5 py-1 rounded-full transition-all duration-200 ease-spring hover:-translate-y-0.5 ${
                    active
                      ? "bg-bay-500 text-white ring-1 ring-bay-700"
                      : "bg-sand-100 hover:bg-bay-200 hover:text-bay-700 text-slate2-700"
                  }`}
                >
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
