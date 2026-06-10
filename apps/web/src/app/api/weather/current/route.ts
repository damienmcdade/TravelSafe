import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap, HttpError } from "@/server/lib/http";
import { anonPostLimited } from "@/server/lib/rate-limit";

// fix(audit weather-proxy-no-ratelimit): public proxy to Open-Meteo with no
// per-route rate limit (the edge middleware doesn't cover /api/weather). Add the
// same cross-instance per-IP gate the community routes use so a single IP can't
// hammer Open-Meteo. 30/min burst + 600/day; fails OPEN if the limiter infra is
// down.
const WX_BURST_LIMIT = 30;
const WX_BURST_WINDOW_SEC = 60;
const WX_DAILY_LIMIT = 600;

const Query = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

interface OpenMeteoCurrent {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    time?: string;
  };
  current_units?: { temperature_2m?: string };
}

// Open-Meteo WMO weather codes → short plain-English labels. We
// surface a tiny conditions string next to the temperature on the
// Weather card. Codes via https://open-meteo.com/en/docs.
const WX_LABEL: Record<number, string> = {
  0:  "clear",
  1:  "mostly clear",
  2:  "partly cloudy",
  3:  "overcast",
  45: "fog",
  48: "freezing fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  77: "snow grains",
  80: "light showers",
  81: "showers",
  82: "heavy showers",
  85: "snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm w/ hail",
  99: "severe thunderstorm",
};

export const dynamic = "force-dynamic";
export const revalidate = 300; // 5 min — Open-Meteo updates ~hourly anyway

/// Current-conditions proxy. Wraps Open-Meteo so the client component
/// doesn't need external-endpoint knowledge AND we get a free 5-min
/// edge cache. No API key required by Open-Meteo for non-commercial
/// use. Returns Fahrenheit by convention since the rest of the app's
/// audience is US-domestic; can later flip on a query param.
export const GET = wrap(async (req: NextRequest) => {
  if (await anonPostLimited(req, {
    burstLimit: WX_BURST_LIMIT,
    burstWindowSec: WX_BURST_WINDOW_SEC,
    dailyLimit: WX_DAILY_LIMIT,
    scope: "weather",
  })) {
    throw new HttpError(429, "rate_limited");
  }
  const { lat, lng } = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph`;
  let payload: OpenMeteoCurrent;
  try {
    const resp = await fetch(url, { next: { revalidate: 300 }, signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new HttpError(502, `open_meteo_${resp.status}`);
    payload = (await resp.json()) as OpenMeteoCurrent;
  } catch (err) {
    throw new HttpError(502, `open_meteo_unreachable: ${(err as Error).message}`);
  }
  const c = payload.current ?? {};
  return NextResponse.json({
    temperatureF: c.temperature_2m ?? null,
    feelsLikeF:   c.apparent_temperature ?? null,
    humidityPct:  c.relative_humidity_2m ?? null,
    windMph:      c.wind_speed_10m ?? null,
    conditions:   c.weather_code != null ? (WX_LABEL[c.weather_code] ?? null) : null,
    observedAt:   c.time ?? null,
    source:       { label: "Open-Meteo", url: "https://open-meteo.com/" },
  });
});
