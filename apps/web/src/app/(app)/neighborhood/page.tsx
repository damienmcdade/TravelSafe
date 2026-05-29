"use client";
import { Suspense, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import { api, useApi } from "@/lib/api-client";
import { requestLocation } from "@/lib/geolocation";
import { ensurePushSubscription } from "@/lib/push";
import { useCity } from "@/lib/use-city";
import { useArea } from "@/lib/use-area";
import { useDocumentTitle } from "@/lib/use-document-title";
import { DataProvenanceBanner, type ProvenanceLike } from "@/components/DataProvenanceBanner";
import { LiveActivityBadge } from "@/components/LiveActivityBadge";
import { TimeOfDayCard } from "@/components/TimeOfDayCard";
import { NewsPanel } from "@/components/NewsPanel";
import { CrimeMixCard } from "@/components/CrimeMixCard";
import { AreaBriefPanel } from "@/components/AreaBriefPanel";
import { AmberAlertsBanner } from "@/components/AmberAlertsBanner";
import { TrendPanel } from "@/components/TrendPanel";
import {
  BlockScoreWidget,
  ThreatFeed,
  useSafeZoneData,
} from "@/components/SafeZoneTab";
// v96 — SafetyPage was eagerly imported here for the "personal" sub-tab,
// which adds ~34 kB to /neighborhood's First Load JS even though most
// visitors land on the default "neighborhood" tab and never click
// "personal". Defer the import so the chunk only loads when the user
// actually switches tabs.
const SafetyPage = dynamic(() => import("../safety/page"), { ssr: false });

interface Alert { area: string; category: "PERSONS"|"PROPERTY"|"SOCIETY"; riskLevel: 1|2|3|4|5; summary: string; recency: string; provenance: ProvenanceLike }

type NeighTab = "neighborhood" | "personal";

const TABS: Array<{ id: NeighTab; label: string; sublabel: string }> = [
  { id: "neighborhood", label: "Neighborhood",   sublabel: "Area-scoped safety information" },
  { id: "personal",     label: "Personal Safety", sublabel: "Emergency, check-in, location sharing" },
];

/// Neighborhood Awareness — area-scoped cards + Personal Safety as a
/// sub-tab. v6 IA: Vigilance retired, its Personal Safety landed here.
function NeighborhoodInner() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = (params?.get("tab") as NeighTab) === "personal" ? "personal" : "neighborhood";
  const [tab, setTab] = useState<NeighTab>(initial);

  useEffect(() => {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (tab === "neighborhood") next.delete("tab");
    else next.set("tab", tab);
    const qs = next.toString();
    router.replace(qs ? `/neighborhood?${qs}` : "/neighborhood", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Neighborhood Awareness" className="surface-muted px-3 py-2 flex flex-wrap gap-1 text-sm">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`neigh-panel-${t.id}`}
            id={`neigh-tab-${t.id}`}
            title={t.sublabel}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-md transition-colors font-medium ${
              tab === t.id ? "bg-bay-500 text-white" : "text-slate2-700 hover:bg-bay-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div hidden={tab !== "neighborhood"} id="neigh-panel-neighborhood" role="tabpanel" aria-labelledby="neigh-tab-neighborhood">
        <NeighborhoodView />
      </div>
      <div hidden={tab !== "personal"} id="neigh-panel-personal" role="tabpanel" aria-labelledby="neigh-tab-personal">
        <SafetyPage />
      </div>
    </div>
  );
}

export default function NeighborhoodAwarenessPage() {
  return (
    <Suspense fallback={<div className="surface p-6 text-sm text-slate2-500 animate-pulse">Loading…</div>}>
      <NeighborhoodInner />
    </Suspense>
  );
}

/// Card layout per the v6 directive:
///   - Search + Use-my-location header row
///   - BlockScore + ThreatFeed (recent dispatches stay — they're
///     the area's own and the user explicitly wanted dispatches HERE)
///   - CrimeMixCard (per-crime color distinction)
///   - TimeOfDayCard (when reports happen)
///   - TrendPanel (week-over-week shift, area-scoped)
///   - NewsPanel (area-scoped, with same selectors as City Awareness)
///   - AreaBriefPanel — AT THE BOTTOM, renamed to "AI Summary"
///
/// Explicitly removed: IncidentSummaryCard ("recent activity"),
/// CrimeChart. Both per user directive.
function NeighborhoodView() {
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
      <AmberAlertsBanner />
      <header className="page-hero flex flex-wrap items-center gap-3 justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Neighborhood Awareness</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl leading-tight text-slate2-900">
            {area
              ? <>What&apos;s happening in <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x break-words">{area.label}</span></>
              : <>Pick a neighborhood in <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x break-words">{city.label}</span></>}
          </h1>
          <p className="mt-2 text-slate2-700 max-w-2xl">
            Area-level only — no individuals tracked, no live street feeds. Search a {city.label} neighborhood below to focus.
          </p>
        </div>
        <LiveActivityBadge />
      </header>

      {/* v23: standalone WheelCityAreaPicker removed from this page.
          Selection is now SOLELY driven by the City pill in the header,
          which embeds the same picker in compact mode. The header is
          the single source of truth so changes propagate consistently
          to /city, /map, /watch, /community without divergent
          selectors. Only the actions column stays here. */}
      <div className="surface p-4 flex flex-col sm:flex-row gap-2 text-sm">
        <button onClick={useMyLocation} disabled={locBusy} className="btn-primary disabled:opacity-60 disabled:cursor-wait">
          {locBusy ? "Locating…" : "Use my location"}
        </button>
        <button onClick={enableNotifications} disabled={pushBusy} className="btn-secondary disabled:opacity-60 disabled:cursor-wait">
          {pushBusy ? "Subscribing…" : "Enable notifications"}
        </button>
        <div className="text-xs text-slate2-500 sm:ml-auto sm:self-center">
          {pushStatus && <p>{pushStatus}</p>}
          {locStatus && <p className="text-sage-700">{locStatus}</p>}
          {locError && <p className="text-amber2-700">{locError}</p>}
          {!pushStatus && !locStatus && !locError && <p>Change city + neighborhood from the header. Notifications default to a once-daily digest.</p>}
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

          <CrimeMixCard areaSlug={area.slug} title={`${area.label} — last 30 days`} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TimeOfDayCard areaSlug={area.slug} areaLabel={area.label} />
            <NewsPanel areaSlug={area.slug} />
          </div>

          {/* Week-over-week trend for this neighborhood (moved from
              City Awareness per v6 directive — area-scoped, not
              duplicated by anything else on this page). */}
          <TrendPanel headingLevel={3} />

          {/* AI Summary sits above the bottom disclaimer banner so
              users see the summary before the legal/provenance footer.
              v7 directive: AI Summary belongs ABOVE the disclaimers. */}
          <AreaBriefPanel areaSlug={area.slug} />

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
  // Per-city adapter source link (real dataset URL, not the generic
  // FBI CDE explorer). Same surfacing as /city's LocalActivity.
  const source = data.source ?? {
    label: `${city.label} official police open-data feed`,
    url: "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend",
  };
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
        source={source}
        loading={data.loading}
      />
    </div>
  );
}
