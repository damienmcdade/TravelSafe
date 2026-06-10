"use client";
import { useEffect, useRef, useState } from "react";
import { useCity } from "@/lib/use-city";
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
///      and SafeZone, scaled for all 44 supported cities. Arrow keys + Enter commit.
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
  const { city } = useCity();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Modal behavior for this aria-modal dialog: outside-click + Escape close
  // (Escape returns focus to the trigger), initial focus moves INTO the dialog
  // on open, and Tab is TRAPPED inside it. fix(audit a11y-picker-no-focustrap):
  // the dialog asserted aria-modal="true" but previously only implemented the
  // Escape half — focus could escape behind the backdrop on this primary nav
  // control. Now matches the delete-account dialog's correct pattern.
  useEffect(() => {
    if (!open) return;
    const focusables = (): HTMLElement[] =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);
    // Move focus into the dialog on open (next tick so the content is mounted).
    const t = setTimeout(() => focusables()[0]?.focus(), 0);
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key === "Tab") {
        const f = focusables();
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // v96 — `pick(slug)` was used by the old per-city dropdown that was
  // replaced by the WheelCityAreaPicker; safe to remove. setCity comes
  // straight from useCity() now.

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
        <>
          {/* v56 — Mobile-first selector overlay. On narrow viewports
              (< sm: 640px) the picker becomes a full-screen MODAL
              anchored to the bottom edge: dim backdrop + sheet that
              uses dynamic viewport height (dvh) so iOS Safari /
              Capacitor WebView correctly accounts for the keyboard
              and the address bar. On wider screens it remains a
              positioned dropdown anchored to the trigger pill.

              The prior single-mode dropdown (`absolute right-0 mt-2
              w-[36rem]`) overflowed the iPhone simulator viewport
              once the THREE stacked wheels + searches + Done button
              were laid out vertically, pushing controls off-screen
              and making the selector inoperable. */}
          <div
            className="sm:hidden fixed inset-0 z-30 bg-slate2-900/50"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            ref={dialogRef}
            role="dialog"
            aria-label="Change state, city and neighborhood"
            aria-modal="true"
            className="
              fixed bottom-0 left-0 right-0 z-40 surface p-3 max-h-[85dvh] overflow-y-auto
              animate-slide-up rounded-t-2xl
              sm:absolute sm:bottom-auto sm:top-auto sm:left-auto sm:right-0 sm:mt-2
              sm:w-[36rem] sm:max-w-[calc(100vw-1rem)] sm:max-h-none sm:rounded-xl sm:animate-pop-in
            "
            // Bottom padding includes safe-area-inset-bottom so the
            // Done button isn't covered by the iOS home indicator on
            // mobile-modal mode. Desktop ignores (env() = 0).
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0px))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="px-1 text-[11px] uppercase tracking-wider text-slate2-500">
                Pick a state, city + neighborhood
              </p>
              {/* Explicit close button for mobile users — outside-tap
                  on the backdrop closes too, but a visible X is the
                  iOS convention and matches what users expect from a
                  bottom-sheet. */}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close picker"
                className="sm:hidden p-1.5 text-slate2-500 hover:text-slate2-900"
              >
                <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3l10 10M13 3L3 13" strokeLinecap="round"/></svg>
              </button>
            </div>
            <WheelCityAreaPicker compact onCommit={() => setOpen(false)} />
          </div>
        </>
      )}
    </div>
  );
}


// StateSelector removed in v45 — its job is folded into the State
// wheel inside WheelCityAreaPicker, which CitySelector now opens.
// Picking a state in the wheel filters the city wheel down to that
// state's cities; the user then picks any city in that state from
// the wheel (instead of the previous flow that auto-jumped to the
// first city and locked the user out of picking a different one).

// Lightweight per-tab notice. Currently every supported city has a working
// feed, so this is a no-op render — kept as an extension point for future
// per-city advisories.
export function CityBanner() {
  return null;
}
