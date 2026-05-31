"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { api, useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { useArea } from "@/lib/use-area";
import { useDocumentTitle } from "@/lib/use-document-title";
import { requestLocation, GeolocationError } from "@/lib/geolocation";

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
  // "ors" → OpenRouteService is configured and one alternative was actively
  // routed to AVOID the highest-report neighborhoods. "osrm" → keyless
  // fallback, alternatives scored after the fact. The UI only claims
  // avoid-routing when this is "ors".
  engine: "ors" | "osrm";
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

  // v52 — From/To now accept either a NEIGHBORHOOD (from the city's
  // autofill list, lat/lng = centroid) OR a free-text ADDRESS that's
  // geocoded server-side via Nominatim. Both paths produce the same
  // {lat, lng, label} shape so compute() doesn't branch.
  //
  // From/To kept as Area to preserve the slug → setGlobalArea pipe
  // when the user picks a neighborhood. Address-mode picks set
  // slug = "" (sentinel) since they don't belong to a tracked area.
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
  // Planned travel time. "now" = no extra weighting; "tonight" weighs
  // nighttime-occurring incidents 1.5× (helpful for routes planned
  // after dark). Active-incident avoidance (last 24h) always fires
  // regardless of this pick. Default "now" keeps the existing
  // behavior so users who don't engage the chip get the same scoring
  // they used to.
  const [travelWhen, setTravelWhen] = useState<"now" | "tonight">("now");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RouteResp | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  // Heatmap visibility now lives inside RouteMap (in-map control,
  // mobile UX audit M4). The page just supplies the data points;
  // RouteMap owns whether they render.

  // Reset selections when the user switches city in the header. A
  // neighborhood from one city's adapter doesn't exist in another's
  // bbox, so carrying it over would silently fail.
  useEffect(() => { setFrom(null); setTo(null); setResult(null); setError(null); }, [city.slug]);

  // Citywide incident counts per area — joined with cityAreas' centroids
  // to produce the heat overlay points. We fetch this only once results
  // are visible so we don't pay the cost for users who never engage the
  // route flow. Same SWR cache key as Awareness/Map, so it's usually
  // an instant cache hit.
  interface CitywideHeatResp { perArea: Array<{ slug: string; incidentCount: number }> }
  const citywideHeatPath = result ? `/crime-data/citywide?city=${city.slug}` : null;
  const { data: citywideHeat } = useApi<CitywideHeatResp>(citywideHeatPath, [citywideHeatPath]);
  const heatPoints = useMemo<Array<[number, number, number]>>(() => {
    if (!citywideHeat || cityAreas.length === 0) return [];
    const bySlug = new Map<string, { centroid: { lat: number; lng: number } }>();
    for (const a of cityAreas) bySlug.set(a.slug, { centroid: a.centroid });
    const max = citywideHeat.perArea.reduce((m, p) => Math.max(m, p.incidentCount), 0) || 1;
    const out: Array<[number, number, number]> = [];
    for (const p of citywideHeat.perArea) {
      const meta = bySlug.get(p.slug);
      if (!meta) continue;
      const w = Math.max(0, Math.min(1, p.incidentCount / max));
      if (w > 0) out.push([meta.centroid.lat, meta.centroid.lng, w]);
    }
    return out;
  }, [citywideHeat, cityAreas]);

  async function compute() {
    setBusy(true); setError(null); setResult(null);
    try {
      if (!from || !to) { setError("Pick a starting neighborhood and a destination neighborhood from the lists."); return; }
      if (from.slug === to.slug) { setError("Starting neighborhood and destination must be different."); return; }
      // Resolve travel time. "tonight" anchors to tonight at 10pm
      // local; that lands squarely in the night window (20:00-06:00)
      // so the scorer's nighttime weighting fires. "now" sends no
      // travelAt param so the scorer doesn't apply night weighting.
      let travelAtParam = "";
      if (travelWhen === "tonight") {
        const tonight = new Date();
        tonight.setHours(22, 0, 0, 0);
        travelAtParam = `&travelAt=${encodeURIComponent(tonight.toISOString())}`;
      }
      const r = await api<RouteResp>(
        `/route/safe?fromLat=${from.centroid.lat}&fromLng=${from.centroid.lng}` +
        `&toLat=${to.centroid.lat}&toLng=${to.centroid.lng}&mode=${mode}${travelAtParam}`,
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
      {/* Warm CartoDB tile-server connections — see /map for full rationale.
          The route view loads the same Leaflet tiles as the crime map. */}
      <link rel="preconnect" href="https://a.basemaps.cartocdn.com" crossOrigin="" />
      <link rel="preconnect" href="https://c.basemaps.cartocdn.com" crossOrigin="" />
      <header className="page-hero">
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Safe Route · {city.label}</p>
        <h1 className="mt-1 font-display text-3xl sm:text-4xl leading-tight text-slate2-900">
          Pick the <span className="bg-title-stripe bg-clip-text text-transparent break-words">statistically safer route</span> through {city.label}
        </h1>
        <p className="mt-2 text-slate2-700 max-w-2xl">
          Select a starting neighborhood and a destination neighborhood — both auto-fill from the same {city.label} neighborhoods CommunitySafe tracks elsewhere. We then pull up to three route alternatives from OpenStreetMap&apos;s routing engine and — where the engine supports it — generate an extra option that actively steers <em>around</em> the neighborhoods with the most recent reports. Each alternative is scored by the recent crime exposure of the neighborhoods it crosses (using the same official police feed that powers the Crime Map) and ranked safest first.
        </p>
      </header>


      {/* The "this is not turn-by-turn navigation" disclaimer is part of
          the value prop — Safe Route is a neighborhood-level analytical
          tool, not Google Maps. We surface it before the inputs so users
          set the right expectation. */}
      <aside className="surface-muted p-4 text-sm text-slate2-700 leading-snug">
        <strong className="text-slate2-900">Neighborhoods + addresses both supported.</strong>{" "}
        Each endpoint can be either a {city.label} neighborhood (autofills from
        the supported list) or a street address / ZIP / landmark (geocoded via
        OpenStreetMap). Toggle the input type with the chip above each box.
        The exposure score still reflects the historical police-feed activity
        of the neighborhoods the polyline crosses — addresses route to the
        nearest supported area for scoring, not turn-by-turn navigation.
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
              <EndpointPicker
                label="From"
                cityLabel={city.label}
                citySlug={city.slug}
                options={cityAreas}
                value={from}
                onPick={pickFrom}
                showFindMyLocation
              />
              <EndpointPicker
                label="To"
                cityLabel={city.label}
                citySlug={city.slug}
                options={cityAreas.filter((a) => a.slug !== from?.slug)}
                value={to}
                onPick={setTo}
              />
            </div>

            <div className="flex flex-wrap items-baseline gap-2 mt-1">
              <span className="text-xs uppercase tracking-wider text-slate2-500 mr-1">Mode:</span>
              {MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  title={m.hint}
                  aria-pressed={mode === m.value}
                  className={`text-sm px-3 py-2 rounded-lg transition-colors ${
                    mode === m.value ? "bg-bay-500 text-white" : "text-slate2-700 hover:bg-bay-50"
                  }`}
                >
                  {m.label}
                </button>
              ))}
              {/* Time-of-travel picker. "Now" keeps the existing
                  scoring (no nighttime weighting). "Tonight"
                  anchors the planned travel to 10pm local, which
                  triggers a 1.5× boost on the weight of incidents
                  that ALSO occurred at night — incidents in the
                  last 24h still get a 2× boost regardless. */}
              <span className="text-xs uppercase tracking-wider text-slate2-500 ml-2 mr-1">When:</span>
              {(["now", "tonight"] as const).map((w) => (
                <button
                  key={w}
                  onClick={() => setTravelWhen(w)}
                  title={w === "now"
                    ? "Score the route against today's average incident pattern."
                    : "Add a 1.5× weight to incidents that occurred at night (20:00-06:00)."}
                  aria-pressed={travelWhen === w}
                  className={`text-sm px-3 py-2 rounded-lg transition-colors ${
                    travelWhen === w ? "bg-bay-500 text-white" : "text-slate2-700 hover:bg-bay-50"
                  }`}
                >
                  {w === "now" ? "Now" : "Tonight"}
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

      {/* v52 — Neighborhood Lookup card. User types any address +
          we return the supported neighborhood it falls inside (via
          /geo/lookup which does Nominatim geocoding then nearest-area
          snap). Lets a user ask "what's the situation around 1600
          Pennsylvania Ave?" without leaving the route planner. */}
      <NeighborhoodLookupCard cityLabel={city.label} citySlug={city.slug} onApplyAsFrom={pickFrom} cityAreas={cityAreas} />

      {result && (
        <>
          {/* Heatmap toggle is now an in-map Leaflet control (rendered
              inside RouteMap), saving vertical screen real-estate on
              mobile where the external button used to push the map
              below the fold. Mobile UX audit M4. */}
          <RouteMap
            from={result.from}
            to={result.to}
            routes={result.routes}
            selectedIdx={selectedIdx}
            ratingStrokes={RATING_TONE}
            heatPoints={heatPoints}
          />

          {/* Avoid-routing badge. Only shown when the production engine
              (OpenRouteService) is active — it's the only path that actually
              routes AROUND the hottest neighborhoods rather than scoring the
              engine's defaults after the fact. Gated on result.engine so we
              never imply avoid-routing on the keyless OSRM fallback. */}
          {result.engine === "ors" && (
            <aside
              className="surface-muted p-3 text-sm text-slate2-700 leading-snug flex items-start gap-2"
              role="note"
            >
              <span aria-hidden className="text-sage-700 mt-px">✦</span>
              <span>
                <strong className="text-slate2-900">Avoid-routing active.</strong>{" "}
                One of the options below was generated to actively steer around the
                {" "}{city.label}{" "}neighborhoods with the most recent reports — not just
                scored after the fact. It may be slightly longer in distance or time in
                exchange for lower historical exposure.
              </span>
            </aside>
          )}

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
            the same official police feed that powers the rest of the app.{" "}
            {result.engine === "ors" && (
              <>One option is additionally routed to actively <strong>avoid</strong> the
              highest-report neighborhoods, so it may trade a little extra distance or time for
              lower historical exposure.{" "}</>
            )}
            The score reflects
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
  // Stable per-instance ids for the listbox and the active option, used
  // by the WAI-ARIA 1.2 combobox pattern: aria-controls links the input
  // to its listbox, aria-activedescendant links to the focused option
  // without moving DOM focus off the input.
  const reactId = useId();
  const listboxId = `combobox-${reactId}`;
  const optionId = (i: number) => `${listboxId}-opt-${i}`;

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
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && matches.length > 0 ? optionId(focusIdx) : undefined}
          aria-label={ariaLabel}
        />
      </label>
      {open && matches.length > 0 && (
        <ul
          id={listboxId}
          aria-label={ariaLabel}
          // v53 — dropdown height bumped 72 (18rem ≈ 9 rows) → 96
          // (24rem ≈ 12 rows) with a vh-cap so big cities can render
          // many rows on tall viewports. overscroll-contain stops
          // touch-scrolls from bubbling out to the page once the
          // listbox is engaged. Touch-action: pan-y ensures touch
          // gestures actually scroll the listbox instead of being
          // intercepted by the combobox input.
          className="absolute z-30 left-0 right-0 mt-1 surface shadow-card-lift max-h-96 sm:max-h-[60vh] overflow-y-auto overscroll-contain touch-pan-y p-1"
          role="listbox"
        >
          {matches.map((m, i) => (
            <li key={m.slug}>
              <button
                type="button"
                id={optionId(i)}
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

/// v52 — wraps NeighborhoodCombobox with a NEIGHBORHOOD ↔ ADDRESS
/// mode toggle. Neighborhood mode preserves the existing autofill
/// behavior. Address mode shows a free-text input that geocodes via
/// /api/geo/lookup on submit; the geocoded result snaps to the
/// nearest supported area centroid (so routing still works against
/// the city's scoring grid).
///
/// `showFindMyLocation` opts in to the geolocation button (typically
/// only on the From slot — the user's "current location").
interface GeoLookupResp {
  area: { slug: string; label: string; jurisdiction: string; centroid: { lat: number; lng: number } };
  matchedVia: "exact" | "zip" | "fuzzy" | "geocode";
  rawQuery: string;
}

function EndpointPicker({
  label, cityLabel, citySlug, options, value, onPick, showFindMyLocation = false,
}: {
  label: "From" | "To";
  cityLabel: string;
  citySlug: string;
  options: Area[];
  value: Area | null;
  onPick: (a: Area | null) => void;
  showFindMyLocation?: boolean;
}) {
  const [mode, setMode] = useState<"neighborhood" | "address">("neighborhood");
  const [addrInput, setAddrInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  async function resolveAddress(q: string) {
    if (!q.trim()) return;
    setBusy(true); setHint(null);
    try {
      // v95p15 — pass citySlug so Nominatim scopes by the selected
      // city's label + bbox. Pre-v95p15 the lookup defaulted to SD
      // and silently snapped non-SD addresses to wrong neighborhoods.
      const r = await api<GeoLookupResp>(`/geo/lookup?q=${encodeURIComponent(q)}&city=${encodeURIComponent(citySlug)}`);
      onPick(r.area);
      // Telegraph the snap-to-area so the user knows we're routing
      // against the nearest supported neighborhood, not the literal
      // street address.
      setHint(`Matched to ${r.area.label}${r.matchedVia === "geocode" ? " (nearest supported neighborhood)" : ""}.`);
    } catch (e) {
      setHint(`Could not find that location: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function useMyLocation() {
    setBusy(true); setHint(null);
    try {
      const pos = await requestLocation();
      const r = await api<GeoLookupResp>(`/geo/lookup?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
      onPick(r.area);
      setHint(`Your location → ${r.area.label}.`);
    } catch (e) {
      const msg = e instanceof GeolocationError ? e.message : (e as Error).message;
      setHint(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate2-500">
        <span>{label}</span>
        <div className="inline-flex rounded-md border border-bay-200 p-0.5">
          <button
            type="button"
            onClick={() => setMode("neighborhood")}
            className={`px-2 py-0.5 rounded text-[11px] transition-colors ${mode === "neighborhood" ? "bg-bay-500 text-white" : "text-slate2-700 hover:bg-bay-50"}`}
            aria-pressed={mode === "neighborhood"}
          >Neighborhood</button>
          <button
            type="button"
            onClick={() => setMode("address")}
            className={`px-2 py-0.5 rounded text-[11px] transition-colors ${mode === "address" ? "bg-bay-500 text-white" : "text-slate2-700 hover:bg-bay-50"}`}
            aria-pressed={mode === "address"}
          >Address</button>
        </div>
        {showFindMyLocation && (
          <button
            type="button"
            onClick={useMyLocation}
            disabled={busy}
            className="ml-auto text-[11px] text-bay-700 hover:underline disabled:opacity-50"
          >
            {busy ? "Locating…" : "Use my location"}
          </button>
        )}
      </div>
      {mode === "neighborhood" ? (
        <NeighborhoodCombobox
          label=""
          placeholder={`Type to search ${options.length} ${cityLabel} neighborhoods`}
          options={options}
          value={value}
          onPick={(a) => { onPick(a); setHint(null); }}
          ariaLabel={`${label} neighborhood in ${cityLabel}`}
        />
      ) : (
        <div>
          <input
            value={addrInput}
            onChange={(e) => setAddrInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void resolveAddress(addrInput); } }}
            placeholder="e.g. 1600 Pennsylvania Ave, Washington DC"
            className="input text-sm"
            autoComplete="off"
            aria-label={`${label} address`}
          />
          <button
            type="button"
            onClick={() => void resolveAddress(addrInput)}
            disabled={busy || !addrInput.trim()}
            className="mt-1 text-xs text-bay-700 hover:underline disabled:opacity-50"
          >
            {busy ? "Looking up…" : "Look up this address"}
          </button>
        </div>
      )}
      {value && mode === "address" && (
        <p className="text-[11px] text-slate2-500">Routing against <strong>{value.label}</strong>.</p>
      )}
      {hint && <p className="text-[11px] text-slate2-500">{hint}</p>}
    </div>
  );
}

/// v52 — Neighborhood Lookup card. Standalone helper card on the
/// Safe Route tab: user types any address + we return the supported
/// neighborhood it falls inside. The "Use as From" button feeds the
/// result back into the route planner above.
function NeighborhoodLookupCard({
  cityLabel,
  citySlug,
  cityAreas,
  onApplyAsFrom,
}: {
  cityLabel: string;
  citySlug: string;
  cityAreas: Area[];
  onApplyAsFrom: (a: Area) => void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GeoLookupResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    if (!q.trim()) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await api<GeoLookupResp>(`/geo/lookup?q=${encodeURIComponent(q)}&city=${encodeURIComponent(citySlug)}`);
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface p-5">
      <h3 className="font-display text-lg text-slate2-900">Neighborhood lookup</h3>
      <p className="text-xs text-slate2-500 mt-0.5">
        Have an address but not sure which {cityLabel} neighborhood it&apos;s in? Type it here.
      </p>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void lookup(); } }}
          placeholder="Street address, ZIP code, or landmark"
          className="input text-sm"
          aria-label="Address, ZIP, or landmark"
        />
        <button
          onClick={lookup}
          disabled={busy || !q.trim()}
          className="btn-primary text-sm px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "Looking up…" : "Look up"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-coral-700">{error}</p>}
      {result && (
        <div className="mt-3 surface-muted p-3 text-sm space-y-1">
          <div className="text-slate2-900">
            <strong>{result.area.label}</strong>
            {" "}
            <span className="text-xs text-slate2-500">({result.area.jurisdiction})</span>
          </div>
          <p className="text-[11px] text-slate2-500">
            Matched via {result.matchedVia === "geocode" ? "geocoding (snapped to nearest supported neighborhood)" : result.matchedVia}.
          </p>
          {cityAreas.some((a) => a.slug === result.area.slug) && (
            <button
              type="button"
              onClick={() => onApplyAsFrom(result.area)}
              className="text-xs text-bay-700 hover:underline"
            >
              Use as starting neighborhood ↑
            </button>
          )}
        </div>
      )}
    </section>
  );
}
