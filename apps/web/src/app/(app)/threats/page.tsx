"use client";
import { useEffect, useState } from "react";
import { api, useApi } from "@/lib/api-client";
import { requestLocation } from "@/lib/geolocation";
import { ensurePushSubscription } from "@/lib/push";
import { useCity } from "@/lib/use-city";
import { DataProvenanceBanner, type ProvenanceLike } from "@/components/DataProvenanceBanner";
import { LocationSearch } from "@/components/LocationSearch";
import { AreaInsightsPanel } from "@/components/AreaInsightsPanel";
import { LiveActivityBadge } from "@/components/LiveActivityBadge";
import { CategoryBreakdown } from "@/components/CategoryBreakdown";
import { RecentIncidentsCards } from "@/components/RecentIncidentsCards";
import { NewsPanel } from "@/components/NewsPanel";
import { CrimeMixCard } from "@/components/CrimeMixCard";
import { SafetyTipsPanel } from "@/components/SafetyTipsPanel";
import { CityBanner } from "@/components/CitySelector";

interface Area { slug: string; label: string; jurisdiction: string }
interface PerArea { slug: string; label: string; incidentCount: number; riskLevel: 1|2|3|4|5; byCategory: { PERSONS: number; PROPERTY: number; SOCIETY: number }; dominantCategory: "PERSONS"|"PROPERTY"|"SOCIETY"|null }
interface Alert { area: string; category: "PERSONS"|"PROPERTY"|"SOCIETY"; riskLevel: 1|2|3|4|5; summary: string; recency: string; provenance: ProvenanceLike }
interface Citywide { city: string; totalIncidents: number; alerts: Alert[]; perArea: PerArea[] }

export default function ThreatsPage() {
  const { city, setCity, cities } = useCity();
  const [area, setArea] = useState<Area | null>(null);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [locError, setLocError] = useState<string | null>(null);

  // Clear selection on city switch so we land on the new city's overview.
  useEffect(() => { setArea(null); }, [city.slug]);

  const { data: citywide } = useApi<Citywide>(area ? null : `/crime-data/citywide?city=${city.slug}`, [area, city.slug]);
  const showingCitywide = !area;

  const citywideCounts = (citywide?.perArea ?? []).reduce(
    (acc, p) => ({
      PERSONS: acc.PERSONS + p.byCategory.PERSONS,
      PROPERTY: acc.PROPERTY + p.byCategory.PROPERTY,
      SOCIETY: acc.SOCIETY + p.byCategory.SOCIETY,
    }),
    { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 },
  );

  const { data: selectedAreaStats } = useApi<{ area: string; alerts: Alert[] }>(
    area ? `/crime-data/alerts?neighborhood=${area.slug}` : null,
    [area?.slug ?? ""],
  );
  const selectedCounts = (() => {
    if (!area) return { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 };
    return citywide?.perArea.find((p) => p.slug === area.slug)?.byCategory ?? { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 };
  })();

  async function useMyLocation() {
    setLocError(null);
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
    }
  }

  async function enableNotifications() {
    const r = await ensurePushSubscription();
    setPushStatus(r.ok ? "Notifications on — you'll get a daily digest by default." : `Notifications not enabled: ${r.reason}.`);
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
          <button onClick={useMyLocation} className="btn-primary">Use my location</button>
          <button onClick={enableNotifications} className="btn-secondary">Enable notifications</button>
          {pushStatus && <p className="text-xs text-slate2-500">{pushStatus}</p>}
          {locError && <p className="text-xs text-amber2-700">{locError}</p>}
          <p className="text-xs text-slate2-500">Notifications default to a once-daily digest.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-6">
          <AreaInsightsPanel areaQueryString={showingCitywide ? `jurisdiction=${city.defaultArea}` : `neighborhood=${area!.slug}`} />
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
          <CrimeMixCard
            areaSlug={area?.slug}
            jurisdictionSlug={!area ? city.defaultArea : undefined}
            title={showingCitywide ? `Specific offenses across ${city.label} — last 30 days` : `${area!.label} — last 30 days`}
          />
          <RecentIncidentsCards
            area={area?.slug}
            jurisdiction={!area ? city.defaultArea : undefined}
            title={showingCitywide ? `Recently reported across ${city.label}` : `Recently reported in ${area!.label}`}
            limit={8}
          />
          <SafetyTipsPanel areaSlug={area?.slug} jurisdictionSlug={!area ? city.defaultArea : undefined} />
          <DataProvenanceBanner provenance={citywide?.alerts[0]?.provenance ?? selectedAreaStats?.alerts[0]?.provenance ?? null} />
        </div>
        <aside className="space-y-4">
          <NewsPanel areaSlug={area?.slug ?? city.slug} />
        </aside>
      </div>
    </main>
  );
}
