"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { api, useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { useArea } from "@/lib/use-area";
import { useDocumentTitle } from "@/lib/use-document-title";

const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => (
    <div className="surface h-[55vh] min-h-[420px] flex items-center justify-center text-slate2-500 animate-pulse">
      Loading map…
    </div>
  ),
});

interface Area { slug: string; label: string; jurisdiction: string; centroid: { lat: number; lng: number } }

export interface RouteAlt {
  coordinates: Array<[number, number]>;
  durationSec: number;
  distanceMeters: number;
  exposureScore: number;
  exposurePer100k: number;
  passesThrough: string[];
  headline: string;
  rating: "A" | "B" | "C" | "D" | "E";
}
interface RouteResp {
  city: { slug: string; label: string };
  from: { lat: number; lng: number };
  to:   { lat: number; lng: number };
  mode: "walking" | "driving" | "transit";
  routes: RouteAlt[];
  source: { label: string; url: string };
  disclaimer: string;
}

// Calm gradient: sage → slate-teal → sand → amber → terracotta. Every
// route gets a meaningful color without anything looking like a hazard
// strip. Strokes are picked so the polyline reads as data, not warning.
const RATING_TONE: Record<RouteAlt["rating"], { stroke: string; tone: string; label: string }> = {
  A: { stroke: "#7BA86E", tone: "text-sage-700",   label: "Safest of the alternatives" },
  B: { stroke: "#2563EB", tone: "text-bay-700",    label: "Lower exposure" },
  C: { stroke: "#94a3b8", tone: "text-slate2-700", label: "Mid exposure" },
  D: { stroke: "#F59E0B", tone: "text-amber2-700", label: "Higher exposure" },
  E: { stroke: "#DC2626", tone: "text-amber2-700", label: "Highest exposure" },
};

// Walking + driving only. Public-transit routing was previously offered as
// a driving-leg proxy (OSRM has no native transit profile); we removed the
// mode entirely because surfacing it implied a level of accuracy we could
// not deliver. The server-side handler still accepts `mode=transit` for
// back-compat with any external bookmark, but the UI no longer offers it.
const MODES: Array<{ value: "walking" | "driving"; label: string; hint: string }> = [
  { value: "walking",  label: "Walking",  hint: "Pedestrian routing via OSM foot profile" },
  { value: "driving",  label: "Driving",  hint: "Vehicle routing via OSM driving profile" },
];

export default function SafeRoutePage() {
  const { city } = useCity();
  // Globally-shared neighborhood selection — the From combobox prefills
  // from whatever the user picked in any other tab. Picking a new From
  // here writes back to global, so the rest of the app follows along.
  const { area: globalArea, setArea: setGlobalArea } = useArea(city.slug);
  useDocumentTitle(`Safe Route · ${city.label}`);
  // Scope autofill to the active city. Routing only works within a single
  // city because the exposure scoring uses that city's police adapter.
  // Response is wrapped — `{ areas, stale? }`.
  interface GeoAreasResp { areas: Area[]; stale?: boolean }
  const areasPath = `/geo/areas?city=${city.slug}`;
  const { data: areasResp, loading: areasLoading, error: areasErr } = useApi<GeoAreasResp>(areasPath, [areasPath]);
  const cityAreas = useMemo(() => {
    const areas = areasResp?.areas ?? [];
    return areas
      // Defensive: a single row with missing `jurisdiction` would crash
      // the whole render via toLowerCase() on undefined — same class of
      // bug as the watch/safety-score AppError boundary triggers we've
      // patched. Match the optional-chain + nullish-fallback pattern.
      .filter((a) => (a?.jurisdiction ?? "").toLowerCase() === city.label.toLowerCase())
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [areasResp, city.label]);

  // Two committed picks + their query strings drive the search UI.
  // We do NOT keep raw free-text — the user must select a neighborhood
  // from the autofill list so the lat/lng we send to the routing engine
  // is always a real, supported area centroid (no geocoding lottery).
  const [from, setFrom] = useState<Area | null>(null);
  const [to, setTo]     = useState<Area | null>(null);

  // Hydrate From from the global area whenever the list of city areas
  // loads and a global pick exists. We only do this when From is still
  // null so we don't overwrite an explicit local pick the user has made.
  useEffect(() => {
    if (from) return;
    if (!globalArea) return;
    if (cityAreas.length === 0) return;
    const match = cityAreas.find((a) => a.slug === globalArea.slug);
    if (match) setFrom(match);
  }, [globalArea, cityAreas, from]);

  // When the user explicitly picks From, mirror it to the global store so
  // the rest of the app sees the same neighborhood. Clearing From also
  // clears the global pick so other tabs don't keep a stale value. Picking
  // To stays local — a destination is transient and shouldn't override the
  // user's "current neighborhood" elsewhere.
  function pickFrom(a: Area | null) {
    setFrom(a);
    setGlobalArea(a ? { slug: a.slug, label: a.label, jurisdiction: a.jurisdiction } : null);
  }
  const [mode, setMode] = useState<"walking" | "driving">("walking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RouteResp | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  // Reset selections when the user switches city in the header. A
  // neighborhood from one city's adapter doesn't exist in another's
  // bbox, so carrying it over would silently fail.
  useEffect(() => { setFrom(null); setTo(null); setResult(null); setError(null); }, [city.slug]);

  async function compute() {
    setBusy(true); setError(null); setResult(null);
    try {
      if (!from || !to) { setError("Pick a starting neighborhood and a destination neighborhood from the lists."); return; }
      if (from.slug === to.slug) { setError("Starting neighborhood and destination must be different."); return; }
      const r = await api<RouteResp>(
        `/route/safe?fromLat=${from.centroid.lat}&fromLng=${from.centroid.lng}` +
        `&toLat=${to.centroid.lat}&toLng=${to.centroid.lng}&mode=${mode}`,
      );
      setResult(r);
      setSelectedIdx(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="space-y-6">
      <header className="page-hero">
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Safe Route · {city.label}</p>
        <h1 className="mt-1 font-display text-3xl sm:text-4xl text-slate2-900">
          Pick the <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x">statistically safer route</span> through {city.label}
        </h1>
        <p className="mt-2 text-slate2-700 max-w-2xl">
          Select a starting neighborhood and a destination neighborhood — both auto-fill from the same {city.label} neighborhoods TravelSafe tracks elsewhere. We then pull up to three route alternatives from OpenStreetMap&apos;s routing engine, score each by the recent crime exposure of the neighborhoods it crosses (using the same official police feed that powers the Crime Map), and rank them safest first.
        </p>
      </header>


      {/* The "this is not turn-by-turn navigation" disclaimer is part of
          the value prop — Safe Route is a neighborhood-level analytical
          tool, not Google Maps. We surface it before the inputs so users
          set the right expectation. */}
      <aside className="surface-muted p-4 text-sm text-slate2-700 leading-snug">
        <strong className="text-slate2-900">Neighborhood-to-neighborhood only.</strong>{" "}
        Safe Route does not accept street addresses, ZIP codes, or landmarks.
        Both endpoints must be {city.label} neighborhoods supported by TravelSafe.
        The resulting polyline runs centroid-to-centroid through {city.label}&apos;s
        actual street network, then the exposure score reflects the historical
        police-feed activity of the neighborhoods that polyline crosses — not a
        turn-by-turn safety guarantee.
      </aside>

      <section className="surface p-5 space-y-3">
        {areasLoading && !areasResp ? (
          <p className="text-sm text-slate2-500 animate-pulse">Loading {city.label} neighborhoods…</p>
        ) : areasErr || cityAreas.length === 0 ? (
          <p className="text-sm text-dusk-700">
            Could not reach the {city.label} neighborhood list. Try switching tabs and back — the police adapter may be warming up.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <NeighborhoodCombobox
                label="From"
                placeholder={`Type to search ${cityAreas.length} ${city.label} neighborhoods`}
                options={cityAreas}
                value={from}
                onPick={pickFrom}
                ariaLabel={`Starting neighborhood in ${city.label}`}
              />
              <NeighborhoodCombobox
                label="To"
                placeholder="Pick a destination neighborhood"
                options={cityAreas.filter((a) => a.slug !== from?.slug)}
                value={to}
                onPick={setTo}
                ariaLabel={`Destination neighborhood in ${city.label}`}
              />
            </div>

            <div className="flex flex-wrap items-baseline gap-2 mt-1">
              <span className="text-xs uppercase tracking-wider text-slate2-500 mr-1">Mode:</span>
              {MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  title={m.hint}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                    mode === m.value ? "bg-bay-500 text-white" : "text-slate2-700 hover:bg-bay-50"
                  }`}
                >
                  {m.label}
                </button>
              ))}
              <button
                onClick={compute}
                disabled={busy || !from || !to || from?.slug === to?.slug}
                className="ml-auto btn-primary text-sm px-4 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? "Routing…" : "Find safe routes"}
              </button>
            </div>
            {error && <p className="text-xs text-coral-700 mt-1">{error}</p>}
          </>
        )}
      </section>

      {result && (
        <>
          <RouteMap
            from={result.from}
            to={result.to}
            routes={result.routes}
            selectedIdx={selectedIdx}
            ratingStrokes={RATING_TONE}
          />

          <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {result.routes.map((r, i) => {
              const tone = RATING_TONE[r.rating];
              const min = Math.round(r.durationSec / 60);
              const km = (r.distanceMeters / 1000).toFixed(1);
              const selected = i === selectedIdx;
              return (
                <button
                  key={i}
                  onClick={() => setSelectedIdx(i)}
                  className={`surface p-4 text-left transition-all ${selected ? "ring-2 ring-bay-400 shadow-card-lift" : "hover:shadow-card"}`}
                >
                  <header className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-white font-display"
                        style={{ background: tone.stroke }}
                      >
                        {r.rating}
                      </span>
                      <span className={`text-xs font-medium ${tone.tone}`}>{tone.label}</span>
                    </div>
                    <span className="text-xs text-slate2-500 tabular-nums">{km} km · {min} min</span>
                  </header>
                  <p className="mt-2 text-sm text-slate2-700 leading-snug">{r.headline}</p>
                  <p className="mt-2 text-xs text-slate2-500 tabular-nums">
                    Exposure score: {r.exposureScore.toLocaleString()} · {r.exposurePer100k.toLocaleString()} per 100k m
                  </p>
                </button>
              );
            })}
          </section>

          {/* Local static disclaimer — we render this instead of the
              server-provided `result.disclaimer` because the server text
              previously mentioned transit-mode caveats, and we now only
              offer walking + driving. Keeping it local also lets us
              guarantee the legal-language posture across deploys. */}
          <p className="surface-muted p-3 text-xs text-slate2-700 leading-snug" role="note">
            <strong className="text-slate2-900">How to read this:</strong>{" "}
            Safe Route supports <strong>walking</strong> and <strong>driving</strong> alternatives
            only. Each polyline is generated by OpenStreetMap&apos;s routing engine and scored by
            the recent crime-report exposure of the {city.label} neighborhoods it crosses, using
            the same official police feed that powers the rest of the app. The score reflects
            <em> historical reporting</em>, not a prediction of what will happen on your trip and not a
            guarantee of safety. This is <strong>not turn-by-turn navigation</strong> and should
            not be used as the sole basis for travel decisions; always follow posted signage,
            traffic laws, and pedestrian-crossing rules, and call 911 in an emergency. Routing
            powered by{" "}
            <a href={result.source.url} target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">
              {result.source.label}
            </a>.
          </p>
        </>
      )}
    </main>
  );
}

/// Lightweight autofill combobox. Filters the supplied option list by
/// substring as the user types, surfaces up to 8 matches, and emits the
/// picked Area to the parent. Closes on outside click; arrow keys move
/// focus through the list. Designed so users CAN'T submit a free-text
/// value — the only way to commit a selection is to pick a real option,
/// which guarantees the routing endpoints always receive a real centroid.
function NeighborhoodCombobox({
  label, placeholder, options, value, onPick, ariaLabel,
}: {
  label: string;
  placeholder: string;
  options: Area[];
  value: Area | null;
  onPick: (a: Area | null) => void;
  ariaLabel: string;
}) {
  const [q, setQ] = useState(value?.label ?? "");
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Sync the displayed text whenever the committed value changes from above
  // (e.g., city switch wipes it). We don't sync on every keystroke since the
  // user owns the input while typing.
  useEffect(() => { setQ(value?.label ?? ""); }, [value]);

  // Outside-click closer.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open]);

  // Match cap: previously hard-capped at 8 rows, which meant cities like
  // Detroit (199 neighborhoods) and Oakland (~100) had ~190 results the
  // user could never reach — the dropdown's `max-h-72 overflow-auto` had
  // nothing to scroll. We now return ALL matches when the user is typing
  // (the dropdown scroller does the right thing) and a generous 12-row
  // preview when the input is empty so a freshly-focused input doesn't
  // dump 200 entries at once.
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options.slice(0, 12);
    return options.filter((a) => a.label.toLowerCase().includes(needle));
  }, [q, options]);

  function pick(a: Area) {
    onPick(a);
    setQ(a.label);
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

  return (
    <div ref={wrapRef} className="relative">
      <label className="block text-sm">
        <span className="text-slate2-700">{label}</span>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setFocusIdx(0);
            // Typing invalidates the previously-picked area; the parent
            // should not run a route until the user re-picks.
            if (value && e.target.value !== value.label) onPick(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="mt-1 input"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-label={ariaLabel}
        />
      </label>
      {open && matches.length > 0 && (
        <ul
          className="absolute z-30 left-0 right-0 mt-1 surface shadow-card-lift max-h-72 overflow-auto p-1"
          role="listbox"
        >
          {matches.map((m, i) => (
            <li key={m.slug}>
              <button
                type="button"
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
          No matching neighborhood. Safe Route only routes between supported {value?.jurisdiction ?? "city"} neighborhoods.
        </div>
      )}
    </div>
  );
}
