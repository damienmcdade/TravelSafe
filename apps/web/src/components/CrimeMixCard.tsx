"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { relativeTime } from "@/lib/sse";
import { explainOffense } from "@/lib/offense-explainer";
import { INCIDENT_CATEGORIES, getIncidentCategory } from "@/lib/incident-categories";

// localStorage key for the user's preferred category chip on the
// CrimeMixCard. Persists across tab + page navigation so a user who
// always cares about women's-safety sees that view by default.
const CATEGORY_STORAGE_KEY = "travelsafe.crime-mix.category.v1";

interface Slice { offense: string; category: "PERSONS" | "PROPERTY" | "SOCIETY"; count: number; lastOccurredAt: string }
interface Mix { area: string; windowDays: number; asOf: string | null; totalIncidents: number; topOffenses: Slice[] }

// Each offense gets its OWN bar color so users can visually distinguish
// "robbery" from "assault" at a glance — not just "Persons" from
// "Property". Per-category palette keeps the family signal (Persons
// shades trend coral, Property amber, Society blue) while every
// offense within a category gets a distinct shade. The offense name
// is hashed to pick an index so the assignment is stable across
// renders + sessions.
const CATEGORY_PALETTE: Record<Slice["category"], string[]> = {
  PERSONS: [
    "linear-gradient(90deg, #FECACA, #B91C1C)",  // muted red
    "linear-gradient(90deg, #FCA5A5, #DC2626)",  // coral
    "linear-gradient(90deg, #F87171, #991B1B)",  // brick
    "linear-gradient(90deg, #FCD3CC, #C2410C)",  // terracotta
    "linear-gradient(90deg, #FBCFE8, #BE185D)",  // berry
    "linear-gradient(90deg, #FECDD3, #9F1239)",  // wine
    "linear-gradient(90deg, #FED7AA, #C2410C)",  // burnt orange
    "linear-gradient(90deg, #FBA8B0, #831843)",  // mulberry
  ],
  PROPERTY: [
    "linear-gradient(90deg, #FDE68A, #B45309)",  // mustard
    "linear-gradient(90deg, #FCD34D, #D97706)",  // amber
    "linear-gradient(90deg, #FEF08A, #A16207)",  // gold
    "linear-gradient(90deg, #FBBF24, #92400E)",  // bronze
    "linear-gradient(90deg, #FDBA74, #C2410C)",  // tangerine
    "linear-gradient(90deg, #FACC15, #854D0E)",  // ochre
    "linear-gradient(90deg, #FCD34D, #92400E)",  // butterscotch
    "linear-gradient(90deg, #FDE047, #713F12)",  // saffron
  ],
  SOCIETY: [
    "linear-gradient(90deg, #BFDBFE, #1E3A8A)",  // navy
    "linear-gradient(90deg, #93C5FD, #1D4ED8)",  // azure
    "linear-gradient(90deg, #A5F3FC, #0E7490)",  // teal
    "linear-gradient(90deg, #C7D2FE, #3730A3)",  // indigo
    "linear-gradient(90deg, #BAE6FD, #075985)",  // sky-deep
    "linear-gradient(90deg, #99F6E4, #115E59)",  // jade
    "linear-gradient(90deg, #DDD6FE, #5B21B6)",  // violet
    "linear-gradient(90deg, #A7F3D0, #047857)",  // emerald
  ],
};

// Category-level color chip (for the small dot before the offense
// name). Stays at the category granularity since it's a single
// dot and chip styling expects Tailwind classes, not gradients.
const CATEGORY_CHIP: Record<Slice["category"], string> = {
  PERSONS:  "bg-coral-500",
  PROPERTY: "bg-amber2-500",
  SOCIETY:  "bg-bay-500",
};

// Cheap deterministic hash — good enough to spread distinct offense
// names across an N-element palette without collisions in practice.
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function offenseBarStyle(offense: string, category: Slice["category"]): string {
  const palette = CATEGORY_PALETTE[category];
  const idx = hashStr(offense) % palette.length;
  return palette[idx];
}

const SOURCE_LABEL: Record<string, string> = {
  "san-diego":     "SDPD NIBRS",
  "los-angeles":   "LAPD Crime Data",
  "san-francisco": "SFPD Incident Reports",
  "chicago":       "Chicago CPD",
  "seattle":       "Seattle PD",
  "new-york":      "NYPD Complaint Data",
  "colorado-springs": "CSPD Open Data",
  "detroit":       "Detroit RMS",
  "washington-dc": "DC MPD",
  "boston":        "Boston BPD",
  "philadelphia":  "Philadelphia PPD",
};

export function CrimeMixCard({ areaSlug, jurisdictionSlug, title }: { areaSlug?: string; jurisdictionSlug?: string; title?: string }) {
  const { city } = useCity();
  // Citywide hits the new ?city= mode on /crime-data/mix. Previously the
  // citywide fallback passed `jurisdiction=<citySlug>` which the route
  // treated as an area slug → zero incidents → empty mix card.
  const path = areaSlug
    ? `/crime-data/mix?neighborhood=${areaSlug}`
    : jurisdictionSlug
      ? `/crime-data/mix?city=${jurisdictionSlug}`
      : null;
  const { data, loading, error } = useApi<Mix>(path, [path]);

  // User-chosen incident-category filter (women's safety, nightlife,
  // scams, etc.). Persists via localStorage so a user who always
  // cares about a specific category sees that view by default. The
  // filter narrows the displayed topOffenses client-side — the
  // underlying API still returns the full list so the user can swap
  // categories without re-fetching.
  const [categoryId, setCategoryIdState] = useState<string>("all");
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CATEGORY_STORAGE_KEY);
      if (stored && INCIDENT_CATEGORIES.some((c) => c.id === stored)) {
        setCategoryIdState(stored);
      }
    } catch { /* ignore */ }
  }, []);
  const setCategoryId = useCallback((next: string) => {
    setCategoryIdState(next);
    try { window.localStorage.setItem(CATEGORY_STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);
  const activeCategory = useMemo(() => getIncidentCategory(categoryId), [categoryId]);
  const filteredOffenses = useMemo(() => {
    const all = data?.topOffenses ?? [];
    if (categoryId === "all") return all;
    return all.filter((o) => activeCategory.match(o.offense));
  }, [data?.topOffenses, categoryId, activeCategory]);
  const max = Math.max(1, ...filteredOffenses.map((o) => o.count));
  const sourceLabel = SOURCE_LABEL[city.slug] ?? `${city.label} police data`;
  const windowText = (() => {
    if (!data || data.totalIncidents === 0) return "";
    const days = data.windowDays;
    if (days < 14)  return `last ${days} days`;
    if (days < 60)  return `last ~${Math.round(days/7)} weeks`;
    if (days < 365) return `last ~${Math.round(days/30)} months`;
    return `past ${(days/365).toFixed(1)} years`;
  })();

  return (
    <section className="surface p-5 bg-gradient-to-br from-white via-white to-bay-50 min-h-[220px] flex flex-col">
      <header className="flex items-baseline justify-between flex-wrap gap-1">
        <h2 className="font-display text-lg text-slate2-900">{title ?? "Specific offenses"}</h2>
        {data && data.totalIncidents > 0 && (
          <span className="text-xs text-slate2-500 tabular-nums">{data.totalIncidents.toLocaleString()} incidents · {windowText}</span>
        )}
      </header>
      <p className="mt-1 text-xs text-slate2-500">
        Top reported offense types from {sourceLabel}{data?.asOf ? `. Most recent report ${relativeTime(data.asOf)}` : ""}. Hover a bar for the most-recent occurrence of that offense.
      </p>

      {/* Personalized category filter chips. Narrows the displayed
          offenses to a single safety-concern category (women's
          safety, scams, nightlife, etc.) on top of the raw NIBRS
          mix. Selection persists via localStorage. */}
      <div className="mt-3 flex flex-wrap gap-1.5 text-xs" role="group" aria-label="Filter offenses by category">
        {INCIDENT_CATEGORIES.map((c) => {
          const active = c.id === categoryId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryId(c.id)}
              aria-pressed={active}
              title={c.description}
              className={`px-2.5 py-1 rounded-full transition-colors ${active ? "bg-bay-500 text-white" : "surface-muted text-slate2-700 hover:bg-bay-100"}`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {loading && (
        <ul className="mt-4 space-y-2.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="space-y-1.5"><div className="skel h-3 w-3/4" /><div className="skel h-3 w-full" /></li>
          ))}
        </ul>
      )}
      {error && !loading && <p className="mt-3 text-sm text-dusk-700">Could not reach the {city.label} police data feed right now.</p>}
      {!loading && !error && (data?.topOffenses ?? []).length === 0 && (
        <p className="mt-3 text-sm text-slate2-500">No incidents from {sourceLabel} for this area in the recent cached window.</p>
      )}
      {!loading && !error && (data?.topOffenses ?? []).length > 0 && filteredOffenses.length === 0 && (
        <p className="mt-3 text-sm text-slate2-500">
          No offenses match the &ldquo;{activeCategory.label}&rdquo; filter in this area&apos;s data. Try a different category or &ldquo;All offenses.&rdquo;
        </p>
      )}
      {!loading && filteredOffenses.length > 0 && (
        <ul className="mt-4 space-y-3">
          {filteredOffenses.map((s) => {
            const pct = (s.count / max) * 100;
            const barBg = offenseBarStyle(s.offense, s.category);
            return (
              <li key={s.offense} className="group" title={`Last reported ${relativeTime(s.lastOccurredAt)}`}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex items-center gap-1.5 text-slate2-900 min-w-0">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${CATEGORY_CHIP[s.category]}`} />
                    <span className="truncate">{s.offense}</span>
                    <OffenseInfoButton offenseName={s.offense} />
                  </span>
                  <span className="tabular-nums text-slate2-700 shrink-0">{s.count.toLocaleString()}</span>
                </div>
                <div className="mt-1 h-2.5 rounded-full bg-sand-100 overflow-hidden">
                  <div className="h-full transition-all duration-700 ease-spring group-hover:saturate-150" style={{ width: `${pct}%`, background: barBg }} />
                </div>
                <div className="mt-0.5 text-[11px] text-slate2-500">Last reported {relativeTime(s.lastOccurredAt)}</div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/// Small "i" button next to each offense name. Click to toggle a
/// plain-English explanation pulled from explainOffense. Closes on
/// outside-click + Escape; uses native focus styling so keyboard
/// users get the same affordance.
function OffenseInfoButton({ offenseName }: { offenseName: string }) {
  const [open, setOpen] = useState(false);
  const info = explainOffense(offenseName);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={`About ${offenseName}`}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="w-4 h-4 inline-flex items-center justify-center rounded-full ring-1 ring-slate2-300 text-[11px] font-semibold text-slate2-500 hover:bg-bay-50 hover:text-bay-700 hover:ring-bay-300 transition-colors"
      >
        i
      </button>
      {open && (
        <>
          {/* Backdrop swallows outside clicks. Transparent and
              z-index just behind the popover so the popover stays
              fully interactive while everything else collapses on
              click. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default bg-transparent"
          />
          <div
            role="dialog"
            aria-label={`${offenseName} explanation`}
            className="absolute z-40 left-1/2 -translate-x-1/2 top-5 w-72 max-w-[calc(100vw-2rem)] surface p-3 text-xs leading-snug shadow-lg ring-1 ring-sand-300"
          >
            <p className="font-medium text-slate2-900">{info.label}</p>
            <p className="mt-1 text-slate2-700">{info.description}</p>
            <p className="mt-2 text-[11px] text-slate2-500">
              Reported as &ldquo;{offenseName}&rdquo; by the city&apos;s police feed.
            </p>
          </div>
        </>
      )}
    </span>
  );
}
