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
import { CategoryBreakdown } from "@/components/CategoryBreakdown";
import { NewsPanel } from "@/components/NewsPanel";
import { OfficialAlertsPanel } from "@/components/OfficialAlertsPanel";
import { UptickTile } from "@/components/UptickTile";
import { CrimeMixCard } from "@/components/CrimeMixCard";
import { DataDisclaimer } from "@/components/DataDisclaimer";
import { CityBanner } from "@/components/CitySelector";
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

interface Area { slug: string; label: string; jurisdiction: string }
interface PerArea { slug: string; label: string; incidentCount: number; riskLevel: 1|2|3|4|5; byCategory: { PERSONS: number; PROPERTY: number; SOCIETY: number }; dominantCategory: "PERSONS"|"PROPERTY"|"SOCIETY"|null }
interface Alert { area: string; category: "PERSONS"|"PROPERTY"|"SOCIETY"; riskLevel: 1|2|3|4|5; summary: string; recency: string; provenance: ProvenanceLike }
interface Citywide { city: string; totalIncidents: number; alerts: Alert[]; perArea: PerArea[] }

export default function ThreatsPage() {
  const { city, setCity, cities } = useCity();
  // Globally-shared neighborhood selection. Picking a neighborhood here
  // propagates to every other tab (SafeZone, CommunitySafe, Personal Safety,
  // Trend Feed, Safety Score) and vice versa.
  const { area, setArea } = useArea(city.slug);
  useDocumentTitle(`Awareness · ${area?.label ?? city.label}`);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
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
  const { data: citywide, error: citywideErr, loading: citywideLoading } = useApi<Citywide>(
    area ? null : `/crime-data/citywide?city=${city.slug}`,
    [area, city.slug],
    { refreshIntervalMs: REFRESH_MS },
  );
  const showingCitywide = !area;

  const citywideCounts = (citywide?.perArea ?? []).reduce(
    (acc, p) => ({
      PERSONS: acc.PERSONS + p.byCategory.PERSONS,
      PROPERTY: acc.PROPERTY + p.byCategory.PROPERTY,
      SOCIETY: acc.SOCIETY + p.byCategory.SOCIETY,
    }),
    { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 },
  );

  const { data: selectedAreaStats, error: areaStatsErr } = useApi<{ area: string; alerts: Alert[] }>(
    area ? `/crime-data/alerts?neighborhood=${area.slug}` : null,
    [area?.slug ?? ""],
    { refreshIntervalMs: REFRESH_MS },
  );
  const selectedCounts = (() => {
    if (!area) return { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 };
    return citywide?.perArea.find((p) => p.slug === area.slug)?.byCategory ?? { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 };
  })();

  async function useMyLocation() {
    if (locBusy) return;
    setLocError(null);
    setLocBusy(true);
    try {
      const pos = await requestLocation();
      const r = await api<{ area: string; label: string; city: string; alerts: Alert[] }>(
        `/crime-data/alerts?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`,
      );
      // If geolocation lands the user in a different supported city, switch
      // the whole app to that city automatically so all tabs follow.
      const matchedCity = cities.find((c) => c.label.toLowerCase() === r.city.toLowerCase());
      if (matchedCity && matchedCity.slug !== city.slug) setCity(matchedCity.slug);
      setArea({ slug: r.area, label: r.label, jurisdiction: r.city });
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

  return (
    <main className="space-y-8">
      <header className="page-hero flex flex-wrap items-center gap-3 justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Awareness · {city.label}</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl text-slate2-900">
            What&apos;s happening in <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x">{city.label}</span>
          </h1>
          <p className="mt-2 text-slate2-700 max-w-2xl">
            Defaults to the whole city. Search a neighborhood, ZIP, or landmark to focus.
            Everything is area-level, pulled from official sources — no individuals tracked, no live street feeds.
          </p>
        </div>
        <LiveActivityBadge />
      </header>

      <CityBanner />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2"><LocationSearch current={area} onResolved={setArea} /></div>
        <div className="surface p-4 flex flex-col gap-2 text-sm">
          <button
            onClick={useMyLocation}
            disabled={locBusy}
            className="btn-primary disabled:opacity-60 disabled:cursor-wait"
          >
            {locBusy ? "Locating…" : "Use my location"}
          </button>
          <button
            onClick={enableNotifications}
            disabled={pushBusy}
            className="btn-secondary disabled:opacity-60 disabled:cursor-wait"
          >
            {pushBusy ? "Subscribing…" : "Enable notifications"}
          </button>
          {pushStatus && <p className="text-xs text-slate2-500">{pushStatus}</p>}
          {locError && <p className="text-xs text-amber2-700">{locError}</p>}
          <p className="text-xs text-slate2-500">Notifications default to a once-daily digest.</p>
        </div>
      </div>

      {/* Surface upstream fetch failures, scoped to whichever feed actually
          failed for the user's current view. Showing the citywide error
          while looking at a specific area (or vice versa) would mis-blame
          the wrong stream. */}
      {showingCitywide && citywideErr && !citywideLoading && (
        <div className="surface p-4 text-sm text-dusk-700">
          Couldn&apos;t reach the {city.label} citywide police feed just now. Cards below may
          show stale cached data — try again in ~10 seconds. ({citywideErr.message})
        </div>
      )}
      {!showingCitywide && areaStatsErr && (
        <div className="surface p-4 text-sm text-dusk-700">
          Couldn&apos;t reach the police feed for {area!.label} just now. Cards below may
          show stale cached data — try again in ~10 seconds. ({areaStatsErr.message})
        </div>
      )}

      <SafeZoneTabSection
        city={{ slug: city.slug, label: city.label }}
        area={area}
      />

      <DataDisclaimer prefix="How to read this:" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-6">
          {!showingCitywide && area && <AreaBriefPanel areaSlug={area.slug} />}
          <CategoryBreakdown
            counts={showingCitywide ? citywideCounts : selectedCounts}
            title={showingCitywide ? `${city.label} category mix` : `${area!.label} — category mix`}
            subtitle="Recent cached window — see source banner below for refresh cadence."
          />
          {showingCitywide && citywide && (
            <section className="surface p-5">
              <h2 className="font-display text-lg text-slate2-900">Neighborhoods by recent incident count</h2>
              <ol className="mt-3 space-y-2 text-sm">
                {citywide.perArea.slice(0, 10).map((p) => {
                  const max = Math.max(1, citywide.perArea[0]?.incidentCount ?? 1);
                  const pct = (p.incidentCount / max) * 100;
                  return (
                    <li key={p.slug}>
                      <div className="flex items-baseline justify-between">
                        <button onClick={() => setArea({ slug: p.slug, label: p.label, jurisdiction: city.label })} className="text-slate2-900 hover:text-bay-700 transition-colors">{p.label}</button>
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
          {/* CrimeMixCard requires a real neighborhood slug — adapters
              don't recognize city slugs as areas. Hidden in citywide
              mode (the CategoryBreakdown above covers the citywide
              picture). */}
          {area && (
            <CrimeMixCard
              areaSlug={area.slug}
              title={`${area.label} — last 30 days`}
            />
          )}
          <DataProvenanceBanner provenance={citywide?.alerts[0]?.provenance ?? selectedAreaStats?.alerts[0]?.provenance ?? null} />
        </div>
        <aside className="space-y-4">
          <UptickTile />
          <NewsPanel areaSlug={area?.slug ?? city.slug} />
          <OfficialAlertsPanel />
        </aside>
      </div>
    </main>
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
          unavailable={!data.loading && !data.blockScore && data.error != null}
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
