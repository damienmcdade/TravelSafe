"use client";
import { useMemo } from "react";
import { useApi } from "@/lib/api-client";

// v95p33 — bucket by the *city's* local clock, not the viewer's runtime.
// `new Date(b.at).getHours()` returned the hour in whatever timezone the
// renderer is running in — which on Vercel is UTC, so an 11pm Pacific
// Sacramento incident landed in the 6am bucket on the histogram. Map
// the area slug to the city's IANA timezone and use Intl.DateTimeFormat.
const CITY_TZ: Record<string, string> = {
  "san-diego": "America/Los_Angeles",
  "los-angeles": "America/Los_Angeles",
  "san-francisco": "America/Los_Angeles",
  "oakland": "America/Los_Angeles",
  "sacramento": "America/Los_Angeles",
  "seattle": "America/Los_Angeles",
  "las-vegas": "America/Los_Angeles",
  "baltimore": "America/New_York",
  "boise": "America/Boise",
  "denver": "America/Denver",
  "colorado-springs": "America/Denver",
  "chicago": "America/Chicago",
  "minneapolis": "America/Chicago",
  "saint-paul": "America/Chicago",
  "milwaukee": "America/Chicago",
  "kansas-city": "America/Chicago",
  "dallas": "America/Chicago",
  "fort-worth": "America/Chicago",
  "new-orleans": "America/Chicago",
  "nola": "America/Chicago",
  "baton-rouge": "America/Chicago",
  "atlanta": "America/New_York",
  "charlotte": "America/New_York",
  "cincinnati": "America/New_York",
  "cleveland": "America/New_York",
  "detroit": "America/Detroit",
  "pittsburgh": "America/New_York",
  "philadelphia": "America/New_York",
  "washington-dc": "America/New_York",
  "norfolk": "America/New_York",
  "buffalo": "America/New_York",
  "new-york": "America/New_York",
  "cambridge": "America/New_York",
  "boston": "America/New_York",
  "raleigh": "America/New_York",
  "indianapolis": "America/Indiana/Indianapolis",
  "tucson": "America/Phoenix",
  "honolulu": "Pacific/Honolulu",
  "long-beach": "America/Los_Angeles",
};
// Mirror cityForArea's slug-prefix scheme without pulling the server-only
// crime-data package into this client component.
const SLUG_PREFIXES: Array<[string, string]> = [
  ["la-", "los-angeles"], ["sf-", "san-francisco"], ["chi-", "chicago"],
  ["sea-", "seattle"], ["ny-", "new-york"], ["cosp-", "colorado-springs"],
  ["det-", "detroit"], ["dc-", "washington-dc"], ["sd-", "san-diego"],
  ["sac-", "sacramento"], ["fw-", "fort-worth"], ["bos-", "boston"],
  ["phl-", "philadelphia"], ["oak-", "oakland"], ["cin-", "cincinnati"],
  ["nola-", "new-orleans"], ["balt-", "baltimore"], ["min-", "minneapolis"],
  ["cle-", "cleveland"], ["mke-", "milwaukee"], ["lv-", "las-vegas"],
  ["boi-", "boise"], ["buf-", "buffalo"], ["nor-", "norfolk"],
  ["kc-", "kansas-city"], ["sp-", "saint-paul"], ["pit-", "pittsburgh"],
  ["dal-", "dallas"], ["char-", "charlotte"], ["atl-", "atlanta"],
  ["denv-", "denver"], ["bat-", "baton-rouge"], ["cam-", "cambridge"],
  ["hon-", "honolulu"], ["ral-", "raleigh"], ["indy-", "indianapolis"],
  ["tuc-", "tucson"],
];

/// Resolve an area slug to its city slug — either the slug IS a city
/// slug (citywide view) or it carries one of the known prefixes.
function citySlugForArea(areaSlug: string): string | null {
  if (CITY_TZ[areaSlug]) return areaSlug;
  for (const [prefix, citySlug] of SLUG_PREFIXES) {
    if (areaSlug.startsWith(prefix)) return citySlug;
  }
  return null;
}

function tzForAreaSlug(areaSlug: string): string {
  const citySlug = citySlugForArea(areaSlug);
  // Default fallback — UTC is still wrong for any US city but at least
  // it's predictable (and matches the pre-fix behavior on Vercel).
  return (citySlug && CITY_TZ[citySlug]) || "UTC";
}

// v99 — cities whose police feed publishes incident DATES only (no
// time-of-day, or a date stored at local midnight). For these the
// hour-of-day histogram is fabricated — every incident collapses into
// one bucket — so we replace the chart with an honest note instead of
// a misleading spike. Mirrors DATE_ONLY_CITY_SLUGS in
// packages/crime-data/src/lib/city-time.ts (kept in sync by hand to
// avoid pulling the server-only crime-data package into this client
// component). Verified 2026-05-31 by sampling each live feed.
const DATE_ONLY_CITIES = new Set<string>([
  "san-diego",
  "charlotte",
  "indianapolis",
  "dallas",
  "norfolk",
]);

const _hourFormatterCache = new Map<string, Intl.DateTimeFormat>();
function hourInTz(d: Date, tz: string): number {
  let fmt = _hourFormatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    });
    _hourFormatterCache.set(tz, fmt);
  }
  // Intl can return "24" for midnight in some locales — normalize.
  const raw = Number(fmt.format(d));
  if (!Number.isFinite(raw)) return 0;
  return raw === 24 ? 0 : raw;
}

interface IncidentDispatch {
  at: string;
  text: string;
  kind?: "trend" | "dispatch";
}
interface TrendResp {
  area: { slug: string; label: string };
  bullets: IncidentDispatch[];
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/// 24-bucket histogram of when incidents occur in a neighborhood
/// (local-clock hour-of-day). Helps users plan around peak hours —
/// e.g., a downtown that's quiet 6am-2pm but spikes 8pm-2am tells
/// a different story than one that's evenly distributed.
/// Source: the same trend feed the SafeZone ThreatFeed consumes.
export function TimeOfDayCard({
  areaSlug,
  areaLabel,
  citySlug,
}: {
  areaSlug: string;
  areaLabel: string;
  /// Authoritative city slug from the page (which knows the selected
  /// city). Preferred over parsing it back out of the area slug —
  /// San Diego's neighborhood slugs are unprefixed (e.g. "pacific-beach")
  /// and the server defaults unprefixed slugs to San Diego, which the
  /// client's best-effort prefix table can't reconstruct. Falls back to
  /// slug-parsing when omitted.
  citySlug?: string;
}) {
  const { data, loading, error } = useApi<TrendResp>(
    `/safezone/trend?area=${encodeURIComponent(areaSlug)}&label=${encodeURIComponent(areaLabel)}`,
    [areaSlug],
  );

  // Resolve the city: explicit prop first, slug-parse fallback second.
  const cityKey = citySlug || citySlugForArea(areaSlug) || undefined;
  const tz = (cityKey && CITY_TZ[cityKey]) || tzForAreaSlug(areaSlug);

  const { buckets, oldestAt, newestAt } = useMemo(() => {
    const out = new Array(24).fill(0) as number[];
    let oldest: number | null = null;
    let newest: number | null = null;
    if (!data) return { buckets: out, oldestAt: null, newestAt: null };
    for (const b of data.bullets) {
      if (b.kind !== "dispatch") continue;
      const t = new Date(b.at);
      const tMs = t.getTime();
      if (Number.isNaN(tMs)) continue;
      const hr = hourInTz(t, tz);
      if (hr >= 0 && hr < 24) out[hr] += 1;
      if (oldest === null || tMs < oldest) oldest = tMs;
      if (newest === null || tMs > newest) newest = tMs;
    }
    return { buckets: out, oldestAt: oldest, newestAt: newest };
  }, [data, tz]);

  const total = buckets.reduce((s, n) => s + n, 0);
  const max = Math.max(1, ...buckets);
  // Peak hour for the summary line.
  const peakHour = buckets.indexOf(max);
  const peakLabel = formatHour(peakHour);
  // v75 — honest data-span line. The trend feed defaults to a 30-day
  // request window, but cities with stale upstreams (LA, NYC, KC,
  // Phoenix) often return dispatches packed into a much shorter
  // actual span. Show users the real span so the histogram's "peak"
  // is interpreted in the right context (a 30-day pattern is more
  // robust than a 5-day spike).
  const spanDays = oldestAt && newestAt
    ? Math.max(1, Math.round((newestAt - oldestAt) / (24 * 60 * 60 * 1000)))
    : null;
  const newestStr = newestAt ? new Date(newestAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;

  if (loading && !data) return (
    <section className="surface p-5 space-y-2">
      <div className="skel h-4 w-1/3" />
      <div className="mt-2 flex items-end gap-1 h-20">
        {HOURS.map((h) => <div key={h} className="skel flex-1 h-full opacity-50" />)}
      </div>
    </section>
  );
  if (error && !data) return (
    <section className="surface p-5 text-sm text-slate2-500">
      Couldn&apos;t load the hour-of-day pattern right now.
    </section>
  );
  if (!data) return null;

  // v99 — date-only feeds carry no real time-of-day, so an hourly
  // histogram would be fabricated (every incident parses to local
  // midnight and collapses into a single bucket). Be honest instead of
  // drawing a misleading spike. The day-level data (and every other
  // card on the page) is still accurate — only the *hour* is unknown.
  if (cityKey && DATE_ONLY_CITIES.has(cityKey)) {
    return (
      <section className="surface p-5">
        <header>
          <h3 className="font-display text-lg text-slate2-900">When incidents happen</h3>
          <p className="text-xs text-slate2-500 mt-0.5">
            {areaLabel}&apos;s police feed records incidents by <strong>date only</strong> — it
            doesn&apos;t publish a time of day — so an hour-by-hour pattern isn&apos;t available
            for this area. The other cards on this page (what gets reported, recent incidents,
            day-level trends) are unaffected; only the exact hour is missing from the source data.
          </p>
        </header>
      </section>
    );
  }
  if (total === 0) {
    // v95p44 — surface the zero-data state explicitly instead of
    // returning null. Hiding the card on zero results created a sync
    // illusion: the rest of the neighborhood page kept rendering data
    // from the same upstream feed (CrimeMix, RecentIncidents, etc.),
    // so users couldn't tell whether the trend feed was empty for
    // legitimate reasons (truly quiet area) or stale. Now we say so.
    return (
      <section className="surface p-5">
        <header>
          <h3 className="font-display text-lg text-slate2-900">When incidents happen</h3>
          <p className="text-xs text-slate2-500 mt-0.5">
            No dispatchable incidents in the trend feed for {areaLabel} over the requested window.
            This card buckets the same trend feed used by the rest of the neighborhood view — when
            it&apos;s empty, the upstream police feed simply hasn&apos;t published recent records
            for this exact area, not that nothing happened there.
          </p>
        </header>
      </section>
    );
  }

  return (
    <section className="surface p-5">
      <header>
        <h3 className="font-display text-lg text-slate2-900">When incidents happen</h3>
        <p className="text-xs text-slate2-500 mt-0.5">
          {total.toLocaleString()} dispatch{total === 1 ? "" : "es"} in {areaLabel}
          {spanDays && newestStr
            ? ` across the ${spanDays}-day span ending ${newestStr}`
            : ""}, bucketed by local hour. Peak around {peakLabel}.
        </p>
      </header>
      {/* 24-bar histogram. Bars are minimal and use the bay accent
          consistent with other charts. Hour labels appear every
          6 hours so the strip doesn't get crowded. */}
      <div className="mt-4 flex items-end gap-0.5 h-24" role="img" aria-label={`Hour-of-day incident distribution for ${areaLabel}`}>
        {buckets.map((n, h) => {
          const pct = (n / max) * 100;
          return (
            <div
              key={h}
              className="flex-1 bg-bay-200 hover:bg-bay-400 transition-colors rounded-sm relative"
              style={{ height: `${Math.max(2, pct)}%` }}
              title={`${formatHour(h)}: ${n} incident${n === 1 ? "" : "s"}`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate2-500 tabular-nums">
        <span>12 AM</span>
        <span>6 AM</span>
        <span>Noon</span>
        <span>6 PM</span>
        <span>12 AM</span>
      </div>
    </section>
  );
}

function formatHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h === 12) return "Noon";
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}
