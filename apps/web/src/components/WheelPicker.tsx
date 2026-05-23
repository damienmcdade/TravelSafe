"use client";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";

export interface WheelItem {
  value: string;
  label: string;
  /** Optional smaller secondary label (e.g. a one-line description). */
  detail?: string;
  /** Disabled items render greyed-out and are non-selectable. */
  disabled?: boolean;
}

interface Props {
  items: WheelItem[];
  value: string;
  onChange: (next: string) => void;
  /** Visible height in px. The center "selection" row sits in the middle. */
  height?: number;
  /** Height of one row in px. Items snap to multiples of this. */
  rowHeight?: number;
  /** Label for screen readers. */
  ariaLabel?: string;
  /**
   * When true, render a type-to-filter input above the wheel. Critical for
   * cities with 100+ neighborhoods (Detroit, Oakland, Boston) where
   * scroll-wheel navigation alone is painful. The filter narrows the list
   * in-place; the wheel snaps to the first match while the user types.
   */
  searchable?: boolean;
  /** Search placeholder text. */
  searchPlaceholder?: string;
}

/// iOS-style scroll wheel. The center row is the selection. Users can drag,
/// trackpad-scroll, or tap an off-center row to bring it to the center.
/// Snap-to-row is enforced with CSS scroll-snap; we also re-snap on scroll-end
/// to handle inertial-scroll undershoot. Faded top/bottom edges give the
/// classic "drum" look. With `searchable` enabled, a text input above the
/// drum narrows the visible items as the user types — turns a 200-row
/// scroll into a few keystrokes.
export function WheelPicker({ items, value, onChange, height = 196, rowHeight = 36, ariaLabel = "Picker", searchable = false, searchPlaceholder = "Type to filter" }: Props) {
  const ref = useRef<HTMLUListElement | null>(null);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.label.toLowerCase().includes(q) || i.value.toLowerCase().includes(q));
  }, [items, query]);
  const enabled = filtered.filter((i) => !i.disabled);
  const [activeIdx, setActiveIdx] = useState(() => {
    const idx = items.findIndex((i) => i.value === value);
    return idx >= 0 ? idx : 0;
  });
  const padding = height / 2 - rowHeight / 2;

  // Sync external value → scroll position. Operates on the FILTERED list
  // when a query is active so the selection lands on a visible row.
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const idx = filtered.findIndex((i) => i.value === value);
    if (idx < 0) return;
    setActiveIdx(idx);
    el.scrollTo({ top: idx * rowHeight, behavior: "smooth" });
  }, [value, filtered, rowHeight]);

  // When the query changes, snap to the first match so the user sees results
  // immediately. Doesn't commit the selection — only repositions the wheel.
  useEffect(() => {
    if (!query) return;
    const el = ref.current; if (!el) return;
    if (filtered.length === 0) return;
    el.scrollTo({ top: 0, behavior: "smooth" });
    setActiveIdx(0);
  }, [query, filtered.length]);

  // Watch scroll position to highlight the row currently centered, and to
  // commit a change once the wheel comes to rest. Operates on the filtered
  // list so the active index always corresponds to a visible row.
  const scrollTimer = useRef<number | null>(null);
  const onScroll = useCallback(() => {
    const el = ref.current; if (!el) return;
    const idx = Math.round(el.scrollTop / rowHeight);
    if (idx !== activeIdx && idx >= 0 && idx < filtered.length) setActiveIdx(idx);
    if (scrollTimer.current) window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => {
      const finalIdx = Math.round(el.scrollTop / rowHeight);
      const item = filtered[finalIdx];
      if (!item) return;
      const target = finalIdx * rowHeight;
      if (Math.abs(el.scrollTop - target) > 1) el.scrollTo({ top: target, behavior: "smooth" });
      if (item.disabled) {
        const direction = el.scrollTop >= activeIdx * rowHeight ? 1 : -1;
        let next = finalIdx + direction;
        while (next >= 0 && next < filtered.length && filtered[next].disabled) next += direction;
        if (next >= 0 && next < filtered.length) {
          el.scrollTo({ top: next * rowHeight, behavior: "smooth" });
          onChange(filtered[next].value);
        }
        return;
      }
      if (item.value !== value) onChange(item.value);
    }, 130);
  }, [filtered, rowHeight, value, activeIdx, onChange]);

  function tap(i: number) {
    const item = filtered[i];
    if (!item || item.disabled) return;
    ref.current?.scrollTo({ top: i * rowHeight, behavior: "smooth" });
    if (item.value !== value) onChange(item.value);
  }

  return (
    <div className="w-full select-none">
      {searchable && (
        <div className="mb-2 relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`${searchPlaceholder} · ${items.length} options`}
            className="input text-sm pr-8"
            aria-label="Filter list"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear filter"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate2-500 hover:text-slate2-900 text-xs px-1.5 py-0.5"
            >
              ×
            </button>
          )}
          {query && (
            <p className="mt-1 text-[11px] text-slate2-500 tabular-nums">
              {filtered.length === 0 ? "No matches" : `${filtered.length} of ${items.length} match`}
            </p>
          )}
        </div>
      )}
      <div className="relative w-full" style={{ height }} role="listbox" aria-label={ariaLabel}>
      {/* Center indicator — two horizontal lines framing the selection row. */}
      <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: padding, height: rowHeight }}>
        <div className="h-full mx-1 rounded-md border border-bay-200 bg-bay-50/60" />
      </div>
      {/* Top + bottom gradient fades for the drum effect. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-12 bg-gradient-to-b from-white to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-12 bg-gradient-to-t from-white to-transparent" />

      <ul
        ref={ref}
        onScroll={onScroll}
        className="relative h-full overflow-y-scroll [scroll-snap-type:y_mandatory] [scrollbar-width:none] [-ms-overflow-style:none]"
        style={{ paddingTop: padding, paddingBottom: padding }}
      >
        <style jsx>{`ul::-webkit-scrollbar { display: none; }`}</style>
        {filtered.map((item, i) => {
          const dist = Math.abs(i - activeIdx);
          const opacity = dist === 0 ? 1 : dist === 1 ? 0.6 : dist === 2 ? 0.35 : 0.18;
          const scale = dist === 0 ? 1 : 0.92;
          return (
            <li
              key={item.value}
              className="[scroll-snap-align:center] flex items-center justify-center"
              style={{ height: rowHeight }}
            >
              <button
                type="button"
                onClick={() => tap(i)}
                disabled={item.disabled}
                className={`w-full text-center transition-all px-3 leading-tight ${item.disabled ? "text-slate2-500 cursor-not-allowed" : i === activeIdx ? "text-slate2-900 font-medium" : "text-slate2-700"}`}
                style={{ opacity, transform: `scale(${scale})` }}
                aria-selected={i === activeIdx}
              >
                <div className="truncate">{item.label}</div>
                {item.detail && (
                  <div className="text-[10px] uppercase tracking-wider text-slate2-500 truncate">{item.detail}</div>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      </div>
    </div>
  );
}
