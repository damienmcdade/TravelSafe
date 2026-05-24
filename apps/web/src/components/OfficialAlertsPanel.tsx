"use client";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";

interface WeatherCurrent {
  temperatureF: number | null;
  feelsLikeF:   number | null;
  humidityPct:  number | null;
  windMph:      number | null;
  conditions:   string | null;
  observedAt:   string | null;
}

interface OfficialAlert {
  id: string;
  source: string;
  category: string;
  severity: "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
  headline: string;
  description: string;
  effective: string;
  expires: string | null;
  url: string;
}

interface Resp { sources: string[]; alerts: OfficialAlert[]; disclaimer: string }

const SEVERITY_CLASS: Record<OfficialAlert["severity"], string> = {
  Extreme:  "bg-dusk-500/15 text-dusk-700",
  Severe:   "bg-amber2-200 text-amber2-700",
  Moderate: "bg-sand-200 text-sand-700",
  Minor:    "bg-sage-200 text-sage-700",
  Unknown:  "bg-sand-100 text-slate2-700",
};

export function OfficialAlertsPanel() {
  // City scopes the NWS state-area pull so we surface weather alerts
  // for the user's selected city. The /official-alerts route also
  // returns USGS earthquakes for the city centroid; we filter to NWS
  // only here because the card is now scoped to weather specifically
  // (the user asked to rename + tighten this card to weather-only
  // updates from official weather agencies).
  const { city } = useCity();
  const { data, error } = useApi<Resp>(`/official-alerts?city=${encodeURIComponent(city.slug)}`, [city.slug]);
  const alerts = (data?.alerts ?? []).filter((a) => a.source === "National Weather Service");
  // Live current-conditions pulled from Open-Meteo via /api/weather/current.
  // Surfaced in the header so users see the temperature for the
  // selected city without leaving the page. 5-min server-side cache
  // keeps cost trivial. Failures are non-blocking — the alerts list
  // still renders normally.
  const { data: wx } = useApi<WeatherCurrent>(
    `/weather/current?lat=${city.centroid.lat}&lng=${city.centroid.lng}`,
    [city.slug],
  );

  return (
    <section className="surface p-6 min-h-[180px]">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="font-display text-lg text-slate2-900">Weather</h2>
        {/* Live temperature pill — appears once the current-conditions
            request resolves. Conditions phrase ("partly cloudy", etc.)
            is appended when available. */}
        {wx?.temperatureF != null && (
          <div className="inline-flex items-baseline gap-1.5 text-sm">
            <span className="font-display text-2xl text-slate2-900 tabular-nums">{Math.round(wx.temperatureF)}°F</span>
            {wx.conditions && <span className="text-xs text-slate2-500">{wx.conditions}</span>}
          </div>
        )}
        <span className="text-xs text-slate2-500">National Weather Service</span>
      </header>
      <p className="mt-1 text-xs text-slate2-500">
        Active NWS alerts for {city.label} — watches, warnings, and advisories from the official US weather agency. Independent of TravelSafe community posts.
        {wx?.feelsLikeF != null && (
          <span> Feels like {Math.round(wx.feelsLikeF)}°F.</span>
        )}
      </p>
      {error && !data && (
        <p className="mt-4 text-sm text-dusk-700">
          Couldn&apos;t reach the National Weather Service right now. Try again in a moment.
        </p>
      )}
      <ul className="mt-4 space-y-3">
        {!error && alerts.length === 0 && (
          <li className="text-sm text-slate2-500 surface-muted p-3">
            No active NWS weather alerts for {city.label} right now. Quiet is good news.
          </li>
        )}
        {alerts.slice(0, 6).map((a) => (
          <li key={a.id} className="surface-muted p-3">
            <div className="flex items-center justify-between gap-3">
              <a href={a.url} target="_blank" rel="noreferrer" className="text-slate2-900 text-sm font-medium hover:underline">
                {a.headline}
              </a>
              <span className={`text-xs px-2 py-0.5 rounded-full ${SEVERITY_CLASS[a.severity]}`}>{a.severity}</span>
            </div>
            <div className="text-xs text-slate2-500 mt-1">
              effective {new Date(a.effective).toLocaleString()}
              {a.expires ? ` · until ${new Date(a.expires).toLocaleString()}` : ""}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
