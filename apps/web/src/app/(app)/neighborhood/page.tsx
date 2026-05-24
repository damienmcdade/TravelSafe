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
import { TimeOfDayCard } from "@/components/TimeOfDayCard";
import { NewsPanel } from "@/components/NewsPanel";
import { CrimeMixCard } from "@/components/CrimeMixCard";
import { AreaBriefPanel } from "@/components/AreaBriefPanel";
import {
  BlockScoreWidget,
  ThreatFeed,
  useSafeZoneData,
} from "@/components/SafeZoneTab";

interface Alert { area: string; category: "PERSONS"|"PROPERTY"|"SOCIETY"; riskLevel: 1|2|3|4|5; summary: string; recency: string; provenance: ProvenanceLike }

/// Neighborhood Awareness — every information card scoped to the
/// user-selected neighborhood. Prominent search bar autofills supported
/// neighborhoods for the currently-selected city (LocationSearch). Use
/// my location button resolves the user's GPS to the closest tracked
/// neighborhood and focuses it.
export default function NeighborhoodAwarenessPage() {
  const { city, setCity, cities } = useCity();
  const { area, setArea } = useArea(city.slug);
  useDocumentTitle(area ? `Neighborhood Awareness · ${area.label}` : `Neighborhood Awareness · ${city.label}`);

  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [locStatus, setLocStatus] = useState<string | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  const REFRESH_MS = 15 * 60 * 1000;
  const { data: selectedAreaStats, error: areaStatsErr } = useApi<{ area: string; alerts: Alert[] }>(
    area ? `/crime-data/alerts?neighborhood=${area.slug}` : null,
    [area?.slug ?? ""],
    { refreshIntervalMs: REFRESH_MS },
  );

  async function useMyLocation() {
    if (locBusy) return;
    setLocError(null); setLocStatus(null); setLocBusy(true);
    try {
      const pos = await requestLocation();
      const r = await api<{ area: string; label: string; city: string; citySlug: string | null; offBbox: boolean; distanceKm: number | null; alerts: Alert[] }>(
        `/crime-data/alerts?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`,
      );
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
    <main className="space-y-4">
      <header className="page-hero flex flex-wrap items-center gap-3 justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Neighborhood Awareness</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl text-slate2-900">
            {area
              ? <>What&apos;s happening in <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x">{area.label}</span></>
              : <>Pick a neighborhood in <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x">{city.label}</span></>}
          </h1>
          <p className="mt-2 text-slate2-700 max-w-2xl">
            Area-level only — no individuals tracked, no live street feeds. Search a {city.label} neighborhood below to focus.
          </p>
        </div>
        <LiveActivityBadge />
      </header>

      {/* Search + location row — primary entry into the page when
          no area is picked. LocationSearch autofills supported
          neighborhoods for the currently-selected city. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <LocationSearch current={area} onResolved={setArea} />
        </div>
        <div className="surface p-4 flex flex-col gap-2 text-sm">
          <button onClick={useMyLocation} disabled={locBusy} className="btn-primary disabled:opacity-60 disabled:cursor-wait">
            {locBusy ? "Locating…" : "Use my location"}
          </button>
          <button onClick={enableNotifications} disabled={pushBusy} className="btn-secondary disabled:opacity-60 disabled:cursor-wait">
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
            Search a {city.label} neighborhood / ZIP / landmark above, use your location, or
            open <a href="/city" className="text-bay-700 hover:underline">City Awareness</a> for the citywide view.
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
          <AreaSafeZoneSection city={{ slug: city.slug, label: city.label }} area={area} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <IncidentSummaryCard areaSlug={area.slug} contextLabel={area.label} />
            <CrimeMixCard areaSlug={area.slug} title={`${area.label} — last 30 days`} />
          </div>

          <AreaBriefPanel areaSlug={area.slug} />

          <CrimeChart
            mode="area"
            citySlug={city.slug}
            cityLabel={city.label}
            areaSlug={area.slug}
            areaLabel={area.label}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TimeOfDayCard areaSlug={area.slug} areaLabel={area.label} />
            <NewsPanel areaSlug={area.slug} />
          </div>

          <DataProvenanceBanner provenance={selectedAreaStats?.alerts[0]?.provenance ?? null} />
        </>
      )}
    </main>
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
    <div className="space-y-3">
      <BlockScoreWidget
        score={data.blockScore}
        loading={data.loading}
        unavailable={!data.loading && !data.blockScore}
        contextLabel={`${area.label}, ${city.label}`}
      />
      <ThreatFeed
        threats={data.threats}
        baseline={data.baseline}
        windowDays={data.windowDays}
        contextLabel={area.label}
        source={{ label: sourceLabel, url: "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend" }}
        loading={data.loading}
      />
    </div>
  );
}
