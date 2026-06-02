// AMBER (Child Abduction Emergency) alerts via the NWS public API.
// NWS distributes IPAWS-OPEN AMBER alerts under the event type
// "Child Abduction Emergency" alongside its weather feed. Same
// no-key public endpoint, same 5-minute rate-limit guidance.
//
// Filtering posture differs from weather: AMBER alerts are issued
// state-wide (or wider) and a missing child can move across cities
// in hours. So unlike NWS weather (where we narrow to alerts that
// mention the user's city), AMBER alerts get returned for the
// user's entire state regardless of which city is selected.
//
// v95p19 — first integration.

import type { OfficialAlert } from "./nws";

// fix(audit alerts-amber-latency-1): AMBER alerts are child-abduction
// emergencies where minutes matter; a 5-minute server cache plus a slow client
// poll could delay surfacing by 15-20 min. Drop to 60s (NWS's own active-alert
// feed updates roughly that often and the per-state key keeps request volume low).
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, { fetchedAt: number; alerts: OfficialAlert[] }>();

interface NwsFeature {
  id: string;
  properties: {
    event?: string;
    headline?: string;
    description?: string;
    severity?: string;
    category?: string;
    sent?: string;
    effective?: string;
    expires?: string;
    areaDesc?: string;
  };
}

/// Pull active AMBER alerts for the given USPS state code. Returns
/// every active "Child Abduction Emergency" alert for that state.
/// When state is null, returns the national active list (so a city
/// without a registered state still surfaces something).
export async function getAmberAlerts(state: string | null): Promise<OfficialAlert[]> {
  const key = (state ?? "US").toUpperCase();
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return hit.alerts;
  try {
    const params = new URLSearchParams({ event: "Child Abduction Emergency" });
    if (state) params.set("area", state);
    const path = `https://api.weather.gov/alerts/active?${params.toString()}`;
    const res = await fetch(path, {
      headers: {
        Accept: "application/geo+json",
        "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/TravelSafe)",
      },
      // fix(audit alerts-no-fetch-timeout-2): bound the upstream call so a hung
      // NWS connection can't pin a serverless invocation; fall back to cache.
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return hit?.alerts ?? [];
    const json = (await res.json()) as { features?: NwsFeature[] };
    const alerts: OfficialAlert[] = (json.features ?? []).map((f) => ({
      id: f.id,
      // Explicit "AMBER" source label so the UI can render the
      // distinct treatment AMBER alerts get vs weather alerts.
      source: "AMBER Alert",
      category: "Safety",
      severity: (f.properties.severity as OfficialAlert["severity"]) ?? "Extreme",
      headline: f.properties.headline ?? f.properties.event ?? "AMBER Alert",
      description: f.properties.description ?? "",
      effective: f.properties.effective ?? f.properties.sent ?? new Date().toISOString(),
      expires: f.properties.expires ?? null,
      // Surface the official DOJ AMBER Alert landing page as the
      // canonical click-through. The NWS CAP detail link is also
      // valid but the public-facing DOJ page is what users expect.
      url: "https://amberalert.ojp.gov/",
    }));
    cache.set(key, { fetchedAt: now, alerts });
    return alerts;
  } catch {
    return hit?.alerts ?? [];
  }
}
