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
import {
  BlockScoreWidget,
  ThreatFeed,
  useSafeZoneData,
} from "@/components/SafeZoneTab";

interface PerArea { slug: string; label: string; incidentCount: number; riskLevel: 1|2|3|4|5; byCategory: { PERSONS: number; PROPERTY: number; SOCIETY: number }; dominantCategory: "PERSONS"|"PROPERTY"|"SOCIETY"|null }
interface Alert { area: string; category: "PERSONS"|"PROPERTY"|"SOCIETY"; riskLevel: 1|2|3|4|5; summary: string; recency: string; provenance: ProvenanceLike }
interface Citywide { city: string; totalIncidents: number; alerts: Alert[]; perArea: PerArea[] }

/// `/now` — unified Awareness. Replaces the legacy /threats City vs
/// Neighborhood toggle with a single scrollable page: city section on
/// top (always rendered), neighborhood section below (auto-resolves
/// from the user's saved area, or shows the inline picker). Both
/// sections live on the same page so state can't be lost on tab
/// switch, and the user sees their city status without having to
/// remember which tab they're on.
export default function NowPage() {
  const { city, setCity, cities } = useCity();
  const { area, setArea } = useArea(city.slug);
  useDocumentTitle(area ? `Now · ${area.label}` : `Now · ${city.label}`);

  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [locStatus, setLocStatus] = useState<string | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  const REFRESH_MS = 15 * 60 * 1000;
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
      }>(`/crime-data/alerts?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`);
      const matchedCity = (r.citySlug && cities.find((c) => c.slug === r.citySlug))
        ?? cities.find((c) => c.label.toLowerCase() === r.city.toLowerCase());
      if (matchedCity && matchedCity.slug !== city.slug) setCity(matchedCity.slug);
      setArea({ slug: r.area, label: r.label, jurisdiction: r.city });
      if (r.offBbox) {
        const km = r.distanceKm != null ? `, ~${Math.round(r.distanceKm)} km away` : "";
        setLocStatus(`Routed to ${r.label} in ${r.city} — closest tracked area${km}.`);
      } else if (r.distanceKm != null && r.distanceKm > 5) {
        setLocStatus(`Showing ${r.label} in ${r.city} — closest tracked area to your location (~${Math.round(r.distanceKm)} km).`);
      } else {
        setLocStatus(`Found you in ${r.label}, ${r.city}.`);
      }
      // Scroll the neighborhood section into view so the user
      // immediately sees their area-scoped cards after a "Use my
      // location" — otherwise the change is silent below the fold.
      requestAnimationFrame(() => {
        document.getElementById("now-neighborhood")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
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

  function selectNeighborhood(slug: string, label: string) {
    setArea({ slug, label, jurisdiction: city.label });
    requestAnimationFrame(() => {
      document.getElementById("now-neighborhood")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const heroTitle = area ? area.label : city.label;

  return (
    <main className="space-y-10">
      <header className="page-hero flex flex-wrap items-center gap-3 justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Now · {city.label}</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl text-slate2-900">
            What&apos;s happening in <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x">{heroTitle}</span>
          </h1>
          <p className="mt-2 text-slate2-700 max-w-2xl">
            Citywide signals up top. Scroll for your neighborhood — or pick one below.
          </p>
        </div>
        <LiveActivityBadge />
      </header>

      {/* --- CITY SECTION --- */}
      <section id="now-city" className="space-y-6" aria-labelledby="now-city-heading">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="now-city-heading" className="font-display text-2xl text-slate2-900">{city.label} — citywide</h2>
          <a href="#now-neighborhood" className="text-xs text-bay-700 hover:underline">Jump to neighborhood ↓</a>
        </div>

        {citywideErr && !citywideLoading && (
          <div role="alert" className="surface p-4 text-sm text-dusk-700">
            Couldn&apos;t reach the {city.label} citywide police feed just now. Cards below may show
            stale cached data — try again in ~10 seconds. ({citywideErr.message})
          </div>
        )}

        <CitywideSafeZoneSection city={{ slug: city.slug, label: city.label }} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-6">
            <IncidentSummaryCard
              citySlug={city.slug}
              contextLabel={`${city.label} (citywide)`}
            />
            <CrimeChart mode="city" citySlug={city.slug} cityLabel={city.label} />
            <DataProvenanceBanner provenance={citywide?.alerts[0]?.provenance ?? null} />
          </div>
          <aside className="space-y-4">
            <HotspotCard
              citySlug={city.slug}
              cityLabel={city.label}
              onPickArea={selectNeighborhood}
            />
            <UptickTile />
            <NewsPanel />
            <OfficialAlertsPanel />
          </aside>
        </div>
      </section>

      {/* --- DIVIDER --- */}
      <div className="border-t border-sand-200" aria-hidden />

      {/* --- NEIGHBORHOOD SECTION --- */}
      <section id="now-neighborhood" className="space-y-6 scroll-mt-6" aria-labelledby="now-area-heading">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <h2 id="now-area-heading" className="font-display text-2xl text-slate2-900">
              {area ? area.label : "Pick a neighborhood"}
            </h2>
            <p className="text-sm text-slate2-500 mt-0.5">
              Area-level only — no individuals tracked, no live street feeds.
            </p>
          </div>
          <a href="#now-city" className="text-xs text-bay-700 hover:underline">↑ Back to city</a>
        </div>

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
            {locStatus && <p className="text-xs text-sage-700">{locStatus}</p>}
            {locError && <p className="text-xs text-amber2-700">{locError}</p>}
            <p className="text-xs text-slate2-500">Notifications default to a once-daily digest.</p>
          </div>
        </div>

        {!area && (
          <section className="surface p-6 text-sm text-slate2-700">
            <h3 className="font-display text-lg text-slate2-900">No neighborhood picked yet</h3>
            <p className="mt-1 text-slate2-500">
              Tap a hotspot above to jump into a specific area, search a neighborhood / ZIP / landmark,
              or use your location.
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
            <AreaSafeZoneSection
              city={{ slug: city.slug, label: city.label }}
              area={area}
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 space-y-6">
                <IncidentSummaryCard areaSlug={area.slug} contextLabel={area.label} />
                <AreaBriefPanel areaSlug={area.slug} />
                <CrimeChart
                  mode="area"
                  citySlug={city.slug}
                  cityLabel={city.label}
                  areaSlug={area.slug}
                  areaLabel={area.label}
                />
                <CrimeMixCard areaSlug={area.slug} title={`${area.label} — last 30 days`} />
                <TimeOfDayCard areaSlug={area.slug} areaLabel={area.label} />
                <DataProvenanceBanner provenance={selectedAreaStats?.alerts[0]?.provenance ?? null} />
              </div>
              <aside className="space-y-4">
                <NewsPanel areaSlug={area.slug} />
              </aside>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function CitywideSafeZoneSection({ city }: { city: { slug: string; label: string } }) {
  const data = useSafeZoneData({
    city: { slug: city.slug, label: city.label },
    area: null,
  });
  const sourceLabel = `${city.label} official police open-data feed`;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2">
        <BlockScoreWidget
          score={data.blockScore}
          loading={data.loading}
          unavailable={!data.loading && !data.blockScore}
          contextLabel={`${city.label} (citywide)`}
        />
      </div>
      <div>
        <ThreatFeed
          threats={data.threats}
          baseline={data.baseline}
          windowDays={data.windowDays}
          contextLabel={`${city.label} citywide`}
          source={{ label: sourceLabel, url: "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend" }}
          loading={data.loading}
        />
      </div>
    </div>
  );
}

function AreaSafeZoneSection({
  city,
  area,
}: {
  city: { slug: string; label: string };
  area: { slug: string; label: string; jurisdiction: string };
}) {
  const data = useSafeZoneData({
    city: { slug: city.slug, label: city.label },
    area: { slug: area.slug, label: area.label },
  });
  const sourceLabel = `${city.label} official police open-data feed`;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2">
        <BlockScoreWidget
          score={data.blockScore}
          loading={data.loading}
          unavailable={!data.loading && !data.blockScore}
          contextLabel={`${area.label}, ${city.label}`}
        />
      </div>
      <div>
        <ThreatFeed
          threats={data.threats}
          baseline={data.baseline}
          windowDays={data.windowDays}
          contextLabel={area.label}
          source={{ label: sourceLabel, url: "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend" }}
          loading={data.loading}
        />
      </div>
    </div>
  );
}
