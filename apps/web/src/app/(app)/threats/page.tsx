"use client";
import { useState } from "react";
import { api, useApi } from "@/lib/api-client";
import { requestLocation } from "@/lib/geolocation";
import { ensurePushSubscription } from "@/lib/push";
import { DataProvenanceBanner, type ProvenanceLike } from "@/components/DataProvenanceBanner";
import { RiskBadge } from "@/components/RiskBadge";
import { LocationSearch } from "@/components/LocationSearch";
import { AreaInsightsPanel } from "@/components/AreaInsightsPanel";
import { LiveActivityBadge } from "@/components/LiveActivityBadge";

interface Area { slug: string; label: string; jurisdiction: string }
interface Alert {
  area: string;
  category: "PERSONS" | "PROPERTY" | "SOCIETY";
  riskLevel: 1 | 2 | 3 | 4 | 5;
  summary: string;
  recency: string;
  provenance: ProvenanceLike;
}
interface Citywide {
  totalIncidents: number;
  alerts: Alert[];
  perArea: { slug: string; label: string; incidentCount: number; riskLevel: 1 | 2 | 3 | 4 | 5 }[];
}

export default function ThreatsPage() {
  const [area, setArea] = useState<Area | null>(null);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [locError, setLocError] = useState<string | null>(null);

  // Citywide-by-default: load whenever no specific area is selected.
  const { data: citywide } = useApi<Citywide>(area ? null : "/crime-data/citywide", [area]);
  // Per-area alerts when a specific area is picked.
  const { data: areaResp } = useApi<{ area: string; alerts: Alert[] }>(
    area ? `/crime-data/alerts?neighborhood=${area.slug}` : null,
    [area?.slug ?? ""],
  );

  async function useMyLocation() {
    setLocError(null);
    try {
      const pos = await requestLocation();
      const r = await api<{ area: Area; matchedVia: string }>(
        `/geo/lookup?q=${pos.coords.latitude},${pos.coords.longitude}`,
      ).catch(async () => {
        // Lat/lng query isn't supported by lookup; fall back to alerts endpoint which accepts lat/lng directly.
        const a = await api<{ area: string; alerts: Alert[] }>(
          `/crime-data/alerts?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`,
        );
        return { area: { slug: a.area, label: a.area, jurisdiction: "San Diego" } as Area, matchedVia: "geo" };
      });
      setArea(r.area);
    } catch (err) {
      setLocError(`Couldn't use location (${(err as Error).message}). Showing citywide view.`);
    }
  }

  async function enableNotifications() {
    const r = await ensurePushSubscription();
    setPushStatus(r.ok ? "Notifications enabled (daily digest by default)." : `Notifications not enabled: ${r.reason}.`);
  }

  const showingCitywide = !area;

  return (
    <main className="space-y-8">
      <header className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="font-display text-3xl text-slate2-900">Area awareness</h1>
          <p className="mt-1 text-slate2-500 max-w-2xl">
            By default this shows the entire <strong>City of San Diego</strong>. Search a specific
            neighborhood, ZIP, or landmark to zoom in. Data is area-level; we don&apos;t track individuals.
          </p>
        </div>
        <LiveActivityBadge />
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <LocationSearch current={area} onResolved={setArea} />
        </div>
        <div className="surface p-4 flex flex-col gap-2 text-sm">
          <button onClick={useMyLocation} className="btn-primary">
            Use my location
          </button>
          <button onClick={enableNotifications} className="btn-secondary">
            Enable notifications
          </button>
          {pushStatus && <p className="text-xs text-slate2-500">{pushStatus}</p>}
          {locError && <p className="text-xs text-amber2-700">{locError}</p>}
          <p className="text-xs text-slate2-500">Notifications default to a once-daily digest.</p>
        </div>
      </div>

      <AreaInsightsPanel
        areaQueryString={showingCitywide ? "jurisdiction=san-diego" : `neighborhood=${area!.slug}`}
      />

      {showingCitywide && citywide && (
        <section className="space-y-3">
          <h2 className="font-display text-2xl text-slate2-900">City of San Diego — category overview</h2>
          {citywide.alerts.length === 0 ? (
            <div className="surface p-6 text-slate2-500">
              No recent incidents in the cached window. That&apos;s typical for most of SD most weeks.
            </div>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {citywide.alerts.map((a, i) => (
                <li key={i} className="surface p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate2-900 font-medium">{a.category.toLowerCase()}</span>
                    <RiskBadge level={a.riskLevel} />
                  </div>
                  <p className="mt-2 text-sm text-slate2-700">{a.summary}</p>
                </li>
              ))}
            </ul>
          )}
          <details className="surface p-4 text-sm">
            <summary className="cursor-pointer text-slate2-700">Top neighborhoods by recent incident count</summary>
            <ol className="mt-3 space-y-1">
              {citywide.perArea.slice(0, 10).map((p) => (
                <li key={p.slug} className="flex justify-between">
                  <button onClick={() => setArea({ slug: p.slug, label: p.label, jurisdiction: "San Diego" })} className="text-slate2-900 hover:underline">
                    {p.label}
                  </button>
                  <span className="text-slate2-500">{p.incidentCount} incidents · </span>
                </li>
              ))}
            </ol>
          </details>
          <DataProvenanceBanner provenance={citywide.alerts[0]?.provenance ?? null} />
        </section>
      )}

      {!showingCitywide && areaResp && (
        <section className="space-y-3">
          <h2 className="font-display text-2xl text-slate2-900">{area!.label}</h2>
          {areaResp.alerts.length === 0 ? (
            <div className="surface p-6 text-slate2-500">No recent incidents in the cached window for this area.</div>
          ) : (
            <ul className="space-y-3">
              {areaResp.alerts.map((a, i) => (
                <li key={i} className="surface p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-slate2-900 font-medium">{a.category.toLowerCase()} incidents</div>
                    <RiskBadge level={a.riskLevel} />
                  </div>
                  <p className="mt-2 text-slate2-700">{a.summary}</p>
                  <p className="text-xs text-slate2-500 mt-2">Reminder: do not approach or confront anyone. Report serious incidents to the police.</p>
                </li>
              ))}
            </ul>
          )}
          <DataProvenanceBanner provenance={areaResp.alerts[0]?.provenance ?? null} />
        </section>
      )}
    </main>
  );
}
