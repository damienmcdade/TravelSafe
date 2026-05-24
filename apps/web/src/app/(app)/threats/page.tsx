"use client";
import { useState } from "react";
import { api, useApi } from "@/lib/api-client";
import { requestLocation } from "@/lib/geolocation";
import { ensurePushSubscription } from "@/lib/push";
import { useCity } from "@/lib/use-city";
import { useArea } from "@/lib/use-area";
import { useDocumentTitle } from "@/lib/use-document-title";
import { DataProvenanceBanner, type ProvenanceLike } from "@/components/DataProvenanceBanner";
import { LocationSearch } from "@/components/LocationSearch";
import { LiveActivityBadge } from "@/components/LiveActivityBadge";
import { CrimeChart } from "@/components/CrimeChart";
import { IncidentSummaryCard } from "@/components/IncidentSummaryCard";
import { HotspotCard } from "@/components/HotspotCard";
import { TimeOfDayCard } from "@/components/TimeOfDayCard";
import { NewsPanel } from "@/components/NewsPanel";
import { OfficialAlertsPanel } from "@/components/OfficialAlertsPanel";
import { UptickTile } from "@/components/UptickTile";
import { CrimeMixCard } from "@/components/CrimeMixCard";
import { AreaBriefPanel } from "@/components/AreaBriefPanel";
// SafeZoneTab — modular drop-in widgets. The page is now a thin layout
// orchestrator: it owns the city/area selection and hands those down to
// the module, which fetches and renders everything itself via the
// useSafeZoneData hook.
import {
  BlockScoreWidget,
  ThreatFeed,
  useSafeZoneData,
} from "@/components/SafeZoneTab";

interface PerArea { slug: string; label: string; incidentCount: number; riskLevel: 1|2|3|4|5; byCategory: { PERSONS: number; PROPERTY: number; SOCIETY: number }; dominantCategory: "PERSONS"|"PROPERTY"|"SOCIETY"|null }
interface Alert { area: string; category: "PERSONS"|"PROPERTY"|"SOCIETY"; riskLevel: 1|2|3|4|5; summary: string; recency: string; provenance: ProvenanceLike }
interface Citywide { city: string; totalIncidents: number; alerts: Alert[]; perArea: PerArea[] }

type AwarenessTab = "city" | "neighborhood";

export default function ThreatsPage() {
  const { city, setCity, cities } = useCity();
  // Globally-shared neighborhood selection. Picking a neighborhood here
  // propagates to every other tab (SafeZone, CommunitySafe, Personal Safety,
  // Trend Feed, Safety Score) and vice versa.
  const { area, setArea } = useArea(city.slug);
  // Sub-tab split: City Awareness vs Neighborhood Awareness. City is the
  // default since the page lands the user on a citywide view; switching
  // to Neighborhood only makes sense once they've picked a specific area
  // (either via the search bar on that tab, the "use my location"
  // button, or by clicking a neighborhood out of the city-level lists).
  const [tab, setTab] = useState<AwarenessTab>("city");
  useDocumentTitle(
    tab === "neighborhood" && area
      ? `Awareness · ${area.label}`
      : `Awareness · ${city.label}`,
  );
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  // Success / informational status from the location flow ("Found you
  // in Pacific Beach, San Diego" or "Routed to LA Downtown — closest
  // tracked area, ~7 km away"). Distinct from locError so we can
  // render the two with different visual weight.
  const [locStatus, setLocStatus] = useState<string | null>(null);
  // Busy flags so the two action buttons render their in-flight state.
  // Geolocation can take 2-5s on cold permission prompts and push
  // subscription waits for the browser dialog; silent buttons made the
  // page feel unresponsive.
  const [locBusy, setLocBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  // 15-minute background refresh on the Awareness tab so the cards rotate
  // through fresh content while the user reads — the upstream adapters cache
  // their police-feed pulls for 5 minutes, so 15 min is the right cadence to
  // pick up new incidents without hammering each city's open-data portal.
  const REFRESH_MS = 15 * 60 * 1000;
  // Citywide fetch always runs (the City tab needs it AND the Neighborhood
  // tab uses citywide.perArea to look up the selected area's category mix).
  // It's a single API call shared across both tabs; gating it by tab would
  // just cause a refetch when the user switches.
  const { data: citywide, error: citywideErr, loading: citywideLoading } = useApi<Citywide>(
    `/crime-data/citywide?city=${city.slug}`,
    [city.slug],
    { refreshIntervalMs: REFRESH_MS },
  );

  const { data: selectedAreaStats, error: areaStatsErr } = useApi<{ area: string; alerts: Alert[] }>(
    area ? `/crime-data/alerts?neighborhood=${area.slug}` : null,
    [area?.slug ?? ""],
    { refreshIntervalMs: REFRESH_MS },
  );

  async function useMyLocation() {
    if (locBusy) return;
    setLocError(null);
    setLocStatus(null);
    setLocBusy(true);
    try {
      const pos = await requestLocation();
      const r = await api<{
        area: string;
        label: string;
        city: string;
        citySlug: string | null;
        offBbox: boolean;
        distanceKm: number | null;
        alerts: Alert[];
      }>(
        `/crime-data/alerts?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`,
      );
      // Prefer the citySlug the server picked over fuzzy label-matching
      // — the route now publishes the canonical slug directly so we
      // don't risk a case/punctuation mismatch ("Washington" vs
      // "Washington, DC", etc.).
      const matchedCity = (r.citySlug && cities.find((c) => c.slug === r.citySlug))
        ?? cities.find((c) => c.label.toLowerCase() === r.city.toLowerCase());
      if (matchedCity && matchedCity.slug !== city.slug) setCity(matchedCity.slug);
      // setArea broadcasts to every useArea subscriber (Safety Score,
      // Crime Chart, Crime Map, AreaBrief, etc.) so the whole app
      // pivots to this neighborhood on a single click.
      setArea({ slug: r.area, label: r.label, jurisdiction: r.city });
      setTab("neighborhood");
      // Friendly status. Three cases worth distinguishing:
      //   (a) Exact-bbox match    → "found you in <area>"
      //   (b) Off-bbox fallback   → "routed to <area> (closest tracked
      //                             area, ~X km away)"
      //   (c) Distance > 5km     → still inside bbox but the nearest
      //                             tracked centroid is far — surface
      //                             the distance so the user knows the
      //                             match is approximate.
      if (r.offBbox) {
        const km = r.distanceKm != null ? `, ~${Math.round(r.distanceKm)} km away` : "";
        setLocStatus(`Routed to ${r.label} in ${r.city} — closest tracked area${km}.`);
      } else if (r.distanceKm != null && r.distanceKm > 5) {
        setLocStatus(`Showing ${r.label} in ${r.city} — closest tracked area to your location (~${Math.round(r.distanceKm)} km).`);
      } else {
        setLocStatus(`Found you in ${r.label}, ${r.city}.`);
      }
    } catch (err) {
      const e = err as Error & { status?: number; body?: { message?: string } };
      const msg = e.body?.message ?? e.message ?? "Unknown error.";
      setLocError(`Could not use your location: ${msg}`);
    } finally {
      setLocBusy(false);
    }
  }

  async function enableNotifications() {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      const r = await ensurePushSubscription();
      setPushStatus(r.ok ? "Notifications on — you'll get a daily digest by default." : `Notifications not enabled: ${r.reason}.`);
    } finally {
      setPushBusy(false);
    }
  }

  // Helper for the City tab's neighborhood lists: clicking a neighborhood
  // sets it as the selected area AND switches to the Neighborhood tab so
  // the click immediately surfaces the per-neighborhood detail view
  // (rather than silently mutating state under the City tab).
  function selectNeighborhood(slug: string, label: string) {
    setArea({ slug, label, jurisdiction: city.label });
    setTab("neighborhood");
  }

  const heroTitle = tab === "neighborhood" && area ? area.label : city.label;

  return (
    <main className="space-y-8">
      <header className="page-hero flex flex-wrap items-center gap-3 justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Awareness · {city.label}</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl text-slate2-900">
            What&apos;s happening in <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x">{heroTitle}</span>
          </h1>
          <p className="mt-2 text-slate2-700 max-w-2xl">
            {tab === "city"
              ? `Citywide view of ${city.label}. Switch to Neighborhood Awareness to drill into a specific area.`
              : `Search a neighborhood, ZIP, or landmark to focus. Everything is area-level, pulled from official sources — no individuals tracked, no live street feeds.`}
          </p>
        </div>
        <LiveActivityBadge />
      </header>

      <AwarenessTabs value={tab} onChange={setTab} />

      {/* Both panels stay MOUNTED across in-page tab switches — only
          visibility toggles via the `hidden` attribute. The previous
          conditional render unmounted the inactive panel on every
          switch, which destroyed all its internal state (CrimeChart
          window selector, expansion toggles, AreaBrief loading state,
          etc.). Coming back to City Awareness after picking "Last
          90 days" on the Crime Chart was reverting it to the 30-day
          default, which looked like a drastic score change to users
          who didn't realize the window had silently reset.

          Both panels do mount their API hooks immediately, but the
          underlying useApi calls share an SWR cache so the second
          panel's "first" fetch is usually instant cache-hit. */}
      <div hidden={tab !== "city"}>
        <CityAwareness
          city={{ slug: city.slug, label: city.label }}
          citywide={citywide ?? null}
          citywideErr={citywideErr}
          citywideLoading={citywideLoading}
          onPickNeighborhood={selectNeighborhood}
        />
      </div>
      <div hidden={tab !== "neighborhood"}>
        <NeighborhoodAwareness
          city={{ slug: city.slug, label: city.label }}
          area={area}
          setArea={setArea}
          areaStatsErr={areaStatsErr}
          areaAlertsProvenance={selectedAreaStats?.alerts[0]?.provenance ?? null}
          onUseMyLocation={useMyLocation}
          onEnableNotifications={enableNotifications}
          locBusy={locBusy}
          pushBusy={pushBusy}
          locError={locError}
          locStatus={locStatus}
          pushStatus={pushStatus}
        />
      </div>
    </main>
  );
}

/// Segmented tab control: City Awareness ↔ Neighborhood Awareness.
/// Uses the same chip-button visual language as CategoryFilterChips on
/// /safety-score so the two pages feel consistent. Full ARIA tabs so
/// screen readers announce the panel switch correctly.
function AwarenessTabs({
  value, onChange,
}: { value: AwarenessTab; onChange: (v: AwarenessTab) => void }) {
  const tabs: Array<{ id: AwarenessTab; label: string; sublabel: string }> = [
    { id: "city",         label: "City Awareness",         sublabel: "Citywide view — auto-populated" },
    { id: "neighborhood", label: "Neighborhood Awareness", sublabel: "Tailored to a specific area" },
  ];
  return (
    <div role="tablist" aria-label="Awareness scope" className="surface-muted px-3 py-2 flex flex-wrap gap-1 text-sm">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          aria-controls={`awareness-panel-${t.id}`}
          id={`awareness-tab-${t.id}`}
          title={t.sublabel}
          onClick={() => onChange(t.id)}
          className={`px-3 py-1.5 rounded-md transition-colors font-medium ${
            value === t.id ? "bg-bay-500 text-white" : "text-slate2-700 hover:bg-bay-100"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/// City Awareness — always citywide. No search bar (auto-populates to
/// the user's selected city via the global useCity store). Renders the
/// citywide SafeZone widgets, citywide category mix, the
/// neighborhoods-by-recent-incidents leaderboard, UptickTile, the city
/// news feed, and the official-alerts dispatch feed.
function CityAwareness({
  city,
  citywide,
  citywideErr,
  citywideLoading,
  onPickNeighborhood,
}: {
  city: { slug: string; label: string };
  citywide: Citywide | null;
  citywideErr: Error | null;
  citywideLoading: boolean;
  onPickNeighborhood: (slug: string, label: string) => void;
}) {
  return (
    <div
      id="awareness-panel-city"
      role="tabpanel"
      aria-labelledby="awareness-tab-city"
      className="space-y-8"
    >
      {citywideErr && !citywideLoading && (
        <div role="alert" className="surface p-4 text-sm text-dusk-700">
          Couldn&apos;t reach the {city.label} citywide police feed just now. Cards below may
          show stale cached data — try again in ~10 seconds. ({citywideErr.message})
        </div>
      )}

      <SafeZoneTabSection city={city} area={null} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-6">
          <IncidentSummaryCard
            citySlug={city.slug}
            contextLabel={`${city.label} (citywide)`}
          />
          <CrimeChart
            mode="city"
            citySlug={city.slug}
            cityLabel={city.label}
          />
          {citywide && (
            <section className="surface p-5">
              <h2 className="font-display text-lg text-slate2-900">Neighborhoods by recent incident count</h2>
              <p className="text-xs text-slate2-500 mt-0.5">Pick one to switch to Neighborhood Awareness for that area.</p>
              <ol className="mt-3 space-y-2 text-sm">
                {citywide.perArea.slice(0, 10).map((p) => {
                  const max = Math.max(1, citywide.perArea[0]?.incidentCount ?? 1);
                  const pct = (p.incidentCount / max) * 100;
                  return (
                    <li key={p.slug}>
                      <div className="flex items-baseline justify-between">
                        <button onClick={() => onPickNeighborhood(p.slug, p.label)} className="text-slate2-900 hover:text-bay-700 transition-colors">{p.label}</button>
                        <span className="text-xs text-slate2-500 tabular-nums">{p.incidentCount.toLocaleString()}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-sand-100 overflow-hidden">
                        <div className="h-full bg-bay-500 transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
          <DataProvenanceBanner provenance={citywide?.alerts[0]?.provenance ?? null} />
        </div>
        <aside className="space-y-4">
          <HotspotCard
            citySlug={city.slug}
            cityLabel={city.label}
            onPickArea={onPickNeighborhood}
          />
          <UptickTile />
          <NewsPanel />
          <OfficialAlertsPanel />
        </aside>
      </div>
    </div>
  );
}

/// Neighborhood Awareness — search bar (moved here from the legacy
/// page header) + area-scoped panels. When no area is picked we show
/// an empty state directing the user to the search; once an area is
/// picked every panel tailors to it (AI brief, BlockScore, ThreatFeed,
/// category mix, last-30-days crime mix, area news).
function NeighborhoodAwareness({
  city,
  area,
  setArea,
  areaStatsErr,
  areaAlertsProvenance,
  onUseMyLocation,
  onEnableNotifications,
  locBusy,
  pushBusy,
  locError,
  locStatus,
  pushStatus,
}: {
  city: { slug: string; label: string };
  area: { slug: string; label: string; jurisdiction: string } | null;
  // Accepts null so LocationSearch can clear the selection (its "clear"
  // affordance fires onResolved(null)). The underlying useArea setter
  // already handles the null case by removing the city's entry from
  // its per-city map.
  setArea: (a: { slug: string; label: string; jurisdiction: string } | null) => void;
  areaStatsErr: Error | null;
  areaAlertsProvenance: ProvenanceLike | null;
  onUseMyLocation: () => void;
  onEnableNotifications: () => void;
  locBusy: boolean;
  pushBusy: boolean;
  locError: string | null;
  locStatus: string | null;
  pushStatus: string | null;
}) {
  return (
    <div
      id="awareness-panel-neighborhood"
      role="tabpanel"
      aria-labelledby="awareness-tab-neighborhood"
      className="space-y-8"
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2"><LocationSearch current={area} onResolved={setArea} /></div>
        <div className="surface p-4 flex flex-col gap-2 text-sm">
          <button
            onClick={onUseMyLocation}
            disabled={locBusy}
            className="btn-primary disabled:opacity-60 disabled:cursor-wait"
          >
            {locBusy ? "Locating…" : "Use my location"}
          </button>
          <button
            onClick={onEnableNotifications}
            disabled={pushBusy}
            className="btn-secondary disabled:opacity-60 disabled:cursor-wait"
          >
            {pushBusy ? "Subscribing…" : "Enable notifications"}
          </button>
          {pushStatus && <p className="text-xs text-slate2-500">{pushStatus}</p>}
          {locStatus && <p className="text-xs text-sage-700">{locStatus}</p>}
          {locError && <p className="text-xs text-amber2-700">{locError}</p>}
          <p className="text-xs text-slate2-500">Notifications default to a once-daily digest.</p>
        </div>
      </div>

      {!area && (
        <section className="surface p-6 text-sm text-slate2-700">
          <h2 className="font-display text-lg text-slate2-900">Pick a neighborhood to focus</h2>
          <p className="mt-1 text-slate2-500">
            Neighborhood Awareness tailors every card — AI brief, BlockScore, ThreatFeed, category mix, and news —
            to the area you select. Search a neighborhood / ZIP / landmark above, use your location, or jump back
            to City Awareness for the citywide view.
          </p>
        </section>
      )}

      {area && areaStatsErr && (
        <div role="alert" className="surface p-4 text-sm text-dusk-700">
          Couldn&apos;t reach the police feed for {area.label} just now. Cards below may
          show stale cached data — try again in ~10 seconds. ({areaStatsErr.message})
        </div>
      )}

      {area && (
        <>
          <SafeZoneTabSection city={city} area={area} />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-6">
              <IncidentSummaryCard
                areaSlug={area.slug}
                contextLabel={area.label}
              />
              <AreaBriefPanel areaSlug={area.slug} />
              <CrimeChart
                mode="area"
                citySlug={city.slug}
                cityLabel={city.label}
                areaSlug={area.slug}
                areaLabel={area.label}
              />
              <CrimeMixCard
                areaSlug={area.slug}
                title={`${area.label} — last 30 days`}
              />
              <TimeOfDayCard areaSlug={area.slug} areaLabel={area.label} />
              <DataProvenanceBanner provenance={areaAlertsProvenance} />
            </div>
            <aside className="space-y-4">
              <NewsPanel areaSlug={area.slug} />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

/// Thin orchestrator around the SafeZoneTab module. Owns ONLY the
/// city/area selection — everything else flows through useSafeZoneData
/// and is rendered by the stateless widgets. This is what the module
/// looks like when a partner application drops it into their own page.
function SafeZoneTabSection({
  city,
  area,
}: {
  city: { slug: string; label: string };
  area: { slug: string; label: string; jurisdiction: string } | null;
}) {
  // CRITICAL — pass `area: null` (NOT a city-slug fallback) when no
  // neighborhood is picked. The previous code fell back to
  // `city.defaultArea` which is a city slug, not a neighborhood slug.
  // Adapters returned zero incidents for it, the per-100k math
  // collapsed to 0, and the Safety Index always read 100 ("safer than
  // national") instead of the citywide score. useSafeZoneData now
  // detects `selection.area === null` and routes to the citywide
  // endpoint variant of /safezone/safety-score, which produces the
  // correct city-wide BlockScore.
  const data = useSafeZoneData({
    city: { slug: city.slug, label: city.label },
    area: area ? { slug: area.slug, label: area.label } : null,
  });
  const displayLabel = area ? `${area.label}, ${city.label}` : `${city.label} (citywide)`;
  const sourceLabel = `${city.label} official police open-data feed`;
  return (
    <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2">
        <BlockScoreWidget
          score={data.blockScore}
          loading={data.loading}
          // Unavailable when the score couldn't be computed for ANY
          // reason — fetch failure OR the underlying area returning
          // zero incidents in the cached window. The latter case used
          // to render as score 100 ("safe"), which falsely told users
          // a no-data area was the safest possible reading. The hook
          // now returns null in that case so this branch fires.
          unavailable={!data.loading && !data.blockScore}
          contextLabel={displayLabel}
        />
      </div>
      <div>
        <ThreatFeed
          threats={data.threats}
          baseline={data.baseline}
          windowDays={data.windowDays}
          contextLabel={area?.label ?? `${city.label} citywide`}
          source={{ label: sourceLabel, url: "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend" }}
          loading={data.loading}
        />
      </div>
    </section>
  );
}
