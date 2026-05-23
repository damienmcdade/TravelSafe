// National Weather Service active alerts. api.weather.gov is a free,
// public, no-key US gov API. We pull the state's active alerts and
// narrow client-side to anything mentioning the user's city — the NWS
// state feed is dense enough that filtering is necessary to stay
// relevant. Cached for 5 minutes per state per their rate-limit
// guidance.

const CACHE_TTL_MS = 5 * 60 * 1000;
// Per-state cache. Switching cities (and therefore states) shouldn't
// nuke the prior state's cache — multiple users on different states
// share the same Node instance via Fluid Compute reuse, so per-state
// caching avoids one user's hop invalidating another's hit.
const cache = new Map<string, { fetchedAt: number; alerts: OfficialAlert[] }>();

export interface OfficialAlert {
  id: string;
  source: string;
  category: string;       // e.g. "Met" (meteorological), "Safety"
  severity: "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
  headline: string;
  description: string;
  effective: string;
  expires: string | null;
  url: string;
}

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

/// Pull active NWS alerts for the given USPS state code and narrow to
/// the city label. If state is missing we fall back to a national pull
/// (which is fine for a card titled "From official sources" — better
/// to show SOMETHING than nothing).
export async function getNwsAlerts(state: string | null, cityLabel: string | null): Promise<OfficialAlert[]> {
  const key = `${state ?? "US"}|${cityLabel ?? ""}`.toLowerCase();
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) return hit.alerts;
  try {
    const path = state
      ? `https://api.weather.gov/alerts/active?area=${encodeURIComponent(state)}`
      : `https://api.weather.gov/alerts/active`;
    const res = await fetch(path, {
      headers: {
        Accept: "application/geo+json",
        "User-Agent": "TravelSafe/0.1 (https://github.com/damienmcdade/TravelSafe)",
      },
    });
    if (!res.ok) return hit?.alerts ?? [];
    const json = (await res.json()) as { features?: NwsFeature[] };
    const cityNeedle = cityLabel?.toLowerCase() ?? null;
    const alerts: OfficialAlert[] = (json.features ?? [])
      .filter((f) => {
        if (!cityNeedle) return true;
        const area = f.properties.areaDesc?.toLowerCase() ?? "";
        // Keep alerts that mention the city by name OR are state-wide
        // (no county-level qualifier in areaDesc means it likely covers
        // the whole state — those are relevant to everyone).
        return area.includes(cityNeedle) || area.split(";").length > 5;
      })
      .map((f) => ({
        id: f.id,
        source: "National Weather Service",
        category: f.properties.category ?? "Met",
        severity: (f.properties.severity as OfficialAlert["severity"]) ?? "Unknown",
        headline: f.properties.headline ?? f.properties.event ?? "Weather alert",
        description: f.properties.description ?? "",
        effective: f.properties.effective ?? f.properties.sent ?? new Date().toISOString(),
        expires: f.properties.expires ?? null,
        url: `https://alerts.weather.gov/cap/wwacapget.php?x=${encodeURIComponent(f.id)}`,
      }));
    cache.set(key, { fetchedAt: now, alerts });
    return alerts;
  } catch {
    return hit?.alerts ?? [];
  }
}

/// Back-compat shim — the original module exported `getOfficialAlerts`
/// with no arguments and a hardcoded San Diego / California filter.
/// Routes that still call it get the legacy behavior.
export async function getOfficialAlerts(): Promise<OfficialAlert[]> {
  return getNwsAlerts("CA", "San Diego");
}
