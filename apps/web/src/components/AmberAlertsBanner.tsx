"use client";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";

interface OfficialAlert {
  id: string;
  source: string;
  category: string;
  severity: string;
  headline: string;
  description: string;
  effective: string;
  expires: string | null;
  url: string;
}
interface Resp { sources: string[]; alerts: OfficialAlert[]; disclaimer: string }

/// v95p19 — dedicated AMBER alert surface. Active AMBER alerts (Child
/// Abduction Emergencies) demand more visual prominence than the
/// rolled-up NWS/USGS list because they're (a) time-critical and (b)
/// rare — most days no AMBER alerts are active, so when one IS active
/// the user should see it immediately, not buried in a multi-source
/// feed.
///
/// Renders inline at the top of the SafeZone tab + Neighborhood
/// Awareness tab. When no active AMBER alert exists for the user's
/// state, this component renders nothing (zero footprint).
///
/// Tailored to user's selected city — the underlying /official-alerts
/// route scopes AMBER pulls by the city's USPS state code, so a
/// California user only sees California AMBER alerts. Switching cities
/// in the header re-runs the fetch.
export function AmberAlertsBanner() {
  const { city } = useCity();
  // fix(audit alerts-amber-latency-1): poll every 90s (vs the default 15-min
  // refresh) and don't serve a stale-cached banner, so a child-abduction alert
  // surfaces promptly. Pairs with the 60s server cache TTL on the AMBER feed.
  const { data } = useApi<Resp>(
    `/official-alerts?city=${encodeURIComponent(city.slug)}`,
    [city.slug],
    { refreshIntervalMs: 90_000, staleWhileRevalidateMs: false },
  );
  const ambers = (data?.alerts ?? []).filter((a) => a.source === "AMBER Alert");
  if (ambers.length === 0) return null;

  return (
    <section
      role="alert"
      aria-live="assertive"
      className="surface p-4 ring-2 ring-coral-500/60 bg-coral-100/40"
      data-testid="amber-alerts-banner"
    >
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span aria-hidden className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-coral-500 text-white text-xs font-bold">!</span>
          <h2 className="font-display text-lg text-coral-700">
            AMBER Alert {ambers.length > 1 ? `· ${ambers.length} active` : ""}
          </h2>
        </div>
        <span className="text-xs text-coral-700">{city.stateLabel ?? "Your state"}</span>
      </header>
      <p className="mt-1 text-xs text-slate2-700">
        Active Child Abduction Emergency in your state, distributed via the National Weather Service IPAWS-OPEN feed. If you have information that could help, dial 911 or 1-800-THE-LOST (NCMEC).
      </p>
      <ul className="mt-3 space-y-3">
        {ambers.map((a) => (
          <li key={a.id} className="bg-white rounded-lg p-3 ring-1 ring-coral-300/60">
            <a
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="text-slate2-900 text-sm font-medium hover:underline block"
            >
              {a.headline}
            </a>
            <div className="text-xs text-slate2-500 mt-1">
              Issued {new Date(a.effective).toLocaleString()}
              {a.expires ? ` · expires ${new Date(a.expires).toLocaleString()}` : ""}
            </div>
            {/* Description can be lengthy CAP boilerplate; trim to the
                first ~280 chars so the banner stays glanceable. The
                "More" link goes to amberalert.ojp.gov for the full
                official record. */}
            {a.description && (
              <p className="text-xs text-slate2-700 mt-2 leading-snug whitespace-pre-wrap">
                {a.description.length > 280 ? a.description.slice(0, 280) + "…" : a.description}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
