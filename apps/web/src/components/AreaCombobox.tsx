"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export interface AreaComboboxOption {
  slug: string;
  label: string;
}

/// Reusable autofill combobox for area / city / neighborhood pickers.
/// Lifted out of SafeZoneAreaPicker so future pickers (the in-progress
/// city compare, the safe-route To/From combobox, etc) can compose the
/// same UI primitive instead of forking it.
///
/// Pure presentation + state — the parent owns:
///   - the canonical option list (already filtered/sorted to the
///     desired scope, e.g. neighborhoods in the active city)
///   - the committed value (what's been "applied" via the commit button)
///   - the in-progress query string
///   - the onCommit handler (the parent typically writes the picked
///     value to a store + closes any compare flow it owns)
///
/// Generic over T so a parent can pass a richer option shape (e.g. one
/// that carries jurisdiction or centroid) and still receive the full
/// object back through onPick/onCommit.
export function AreaCombobox<T extends AreaComboboxOption>({
  options,
  value,
  onPick,
  query,
  onQueryChange,
  scopeLabel,
  commitLabel,
  committedSlug,
  onCommit,
}: {
  options: T[];
  value: T | null;
  onPick: (a: T | null) => void;
  query: string;
  onQueryChange: (q: string) => void;
  /// Used in the placeholder + ARIA labels: "Search {scopeLabel}
  /// neighborhoods…". Typically the city name.
  scopeLabel: string;
  commitLabel: string;
  committedSlug: string | null;
  onCommit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Stable ids so the input can announce listbox + active option via
  // aria-controls + aria-activedescendant (WAI-ARIA 1.2 combobox).
  // Scope-derived so multiple comboboxes on a page don't collide.
  const sanitized = scopeLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "combobox";
  const listboxId = `combobox-list-${sanitized}`;
  const optionId = (slug: string) => `combobox-opt-${sanitized}-${slug}`;

  // Outside-click closer.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open]);

  // Show ALL options regardless of query state — the dropdown's
  // max-h-72 overflow-auto scrolls through them. An earlier 8-row cap
  // on empty input blocked the "browse all" use case.
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((a) => a.label.toLowerCase().includes(needle));
  }, [query, options]);

  function pick(a: T) {
    onPick(a);
    onQueryChange(a.label);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setFocusIdx((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const p = matches[focusIdx];
      if (p) pick(p);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const commitDisabled = !value || value.slug === committedSlug;
  return (
    <div className="flex flex-col sm:flex-row sm:items-end gap-2">
      <div ref={wrapRef} className="relative flex-1 min-w-0">
        <label className="block text-sm">
          <span className="sr-only">Search {scopeLabel} neighborhoods</span>
          <input
            value={query}
            onChange={(e) => {
              onQueryChange(e.target.value);
              setOpen(true);
              setFocusIdx(0);
              // Typing invalidates the previously-picked area; the parent
              // should not commit until the user re-picks.
              if (value && e.target.value !== value.label) onPick(null);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={`Search ${options.length} ${scopeLabel} neighborhoods…`}
            className="input text-sm"
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={open && matches[focusIdx] ? optionId(matches[focusIdx].slug) : undefined}
            aria-label={`Search ${scopeLabel} neighborhoods`}
          />
        </label>
        {open && matches.length > 0 && (
          <ul
            id={listboxId}
            className="absolute z-30 left-0 right-0 mt-1 surface shadow-card-lift max-h-72 overflow-auto p-1"
            role="listbox"
            aria-label={`${scopeLabel} neighborhoods`}
          >
            {matches.map((m, i) => (
              <li key={m.slug}>
                <button
                  type="button"
                  id={optionId(m.slug)}
                  onMouseEnter={() => setFocusIdx(i)}
                  onMouseDown={(e) => { e.preventDefault(); pick(m); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    i === focusIdx ? "bg-bay-100 text-slate2-900" : "hover:bg-sand-100 text-slate2-900"
                  }`}
                  role="option"
                  aria-selected={i === focusIdx}
                >
                  {m.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {open && matches.length === 0 && (
          <div className="absolute z-30 left-0 right-0 mt-1 surface shadow-card-lift p-3 text-xs text-slate2-500">
            No matching neighborhood in {scopeLabel}.
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onCommit}
        disabled={commitDisabled}
        className="btn-primary text-xs px-3 py-2 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
      >
        {value && value.slug === committedSlug ? "Showing" : commitLabel}
      </button>
    </div>
  );
}
