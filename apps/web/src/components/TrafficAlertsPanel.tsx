"use client";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";

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

/// CHP traffic surface — collisions and road closures near the user's
/// city, sourced from the California Highway Patrol CAD feed via the
/// shared /official-alerts route. Like the AMBER banner this renders
/// NOTHING when there are no active CHP incidents (the common case, and
/// the entire case for the 28 non-California cities), so it never adds
/// an empty card. Styled calm — traffic is awareness, not emergency —
/// to stay on the right side of the project's anti-fear posture.
export function TrafficAlertsPanel() {
  const { city } = useCity();
  const { data } = useApi<Resp>(`/official-alerts?city=${encodeURIComponent(city.slug)}`, [city.slug]);
  const incidents = (data?.alerts ?? []).filter((a) => a.source === "CHP Traffic");
  if (incidents.length === 0) return null;

  return (
    <section className="surface p-5" data-testid="traffic-alerts-panel">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="font-display text-lg text-slate2-900">Road conditions</h2>
        <span className="text-xs text-slate2-500">California Highway Patrol</span>
      </header>
      <p className="mt-1 text-xs text-slate2-500">
        Active CHP collisions and road closures near {city.label}. From the official
        CHP computer-aided-dispatch feed — independent of TravelSafe community posts.
      </p>
      <ul className="mt-4 space-y-3">
        {incidents.map((a) => (
          <li key={a.id} className="surface-muted p-3">
            <div className="flex items-center justify-between gap-3">
              <a href={a.url} target="_blank" rel="noreferrer" className="text-slate2-900 text-sm font-medium hover:underline">
                {a.headline}
              </a>
              <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${SEVERITY_CLASS[a.severity]}`}>{a.severity}</span>
            </div>
            <div className="text-xs text-slate2-500 mt-1">
              reported {new Date(a.effective).toLocaleString()}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
