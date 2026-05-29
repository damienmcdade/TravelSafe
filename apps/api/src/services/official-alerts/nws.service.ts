// National Weather Service active alerts for the San Diego region.
// api.weather.gov is a free, public, no-key US gov API. Caches the response
// for 5 minutes per their rate-limit guidance.
//
// NOTE: This Express service is the legacy single-source path. The live
// multi-source aggregator now lives on the web side
// (apps/web/src/app/api/official-alerts/route.ts), which fans out across
// NWS + USGS + AMBER + CHP adapters. CHP traffic incidents were added
// there (apps/web/.../official-alerts/chp.ts) via the CalTrans QuickMap
// public feed, gated to California cities.
//
// SDPD press-release RSS and City-of-SD street-closure data are
// intentionally NOT implemented: both are single-city (San Diego) feeds,
// and the app now spans 30+ cities, so a per-city press-release adapter
// is low-leverage versus the statewide/national sources above. Revisit
// only if a city-specific "local agency bulletin" surface is greenlit.

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { fetchedAt: number; alerts: OfficialAlert[] } | null = null;

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

export async function getOfficialAlerts(): Promise<OfficialAlert[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.alerts;
  try {
    // Filter to California; client-side narrow to anything mentioning San Diego.
    const res = await fetch("https://api.weather.gov/alerts/active?area=CA", {
      headers: {
        Accept: "application/geo+json",
        "User-Agent": "TravelSafe/0.1 (https://github.com/damienmcdade/TravelSafe)",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return cache?.alerts ?? [];
    const json = (await res.json()) as { features?: NwsFeature[] };
    const alerts: OfficialAlert[] = (json.features ?? [])
      .filter((f) => {
        const area = f.properties.areaDesc?.toLowerCase() ?? "";
        return area.includes("san diego") || area.includes("southern california");
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
      }))
      .sort((a, b) => +new Date(b.effective) - +new Date(a.effective));
    cache = { fetchedAt: now, alerts };
    return alerts;
  } catch {
    return cache?.alerts ?? [];
  }
}
