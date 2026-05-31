/// v96p2 — city-local-wall-clock → UTC conversion helper.
///
/// Several upstream police feeds publish timestamps as "wall-clock"
/// strings in the city's local timezone without a TZ marker:
///   - Sacramento: `Occurrence_Date_PT` → 2026-05-16 22:40:49 (PT)
///   - LAPD: `date_occ` → 2026-05-16T22:40:49.000 (LA local)
///   - SFPD: `incident_datetime` → 2026-05-16T22:40:49 (LA local)
///   - Chicago: `date` → 2026-05-16T22:40:49 (CT local)
///   - … and most other Socrata floating_timestamp datasets.
///
/// JavaScript's `new Date(localString)` interprets the string as
/// local-to-server. On Railway (UTC), that produces a Date offset
/// by the source-city's UTC offset (7-8 h for PT, 5-6 h for ET, …).
/// The displayed "When · 3h ago" then shows the wrong time-of-day on
/// the client — incidents that occurred 30 minutes ago in LA show
/// up as "8h ago" because the parsed Date is 8 hours ahead of true UTC.
///
/// `cityLocalToUtcIso(localStr, tz)` treats `localStr` as wall-clock
/// in `tz` (e.g., "America/Los_Angeles"), computes the UTC offset of
/// that wall-clock moment (DST-aware), and returns a canonical UTC
/// ISO string with a `Z` suffix. Output is always parseable by the
/// frontend `relativeTime` helper without TZ ambiguity.

const ZERO_ISO = new Date(0).toISOString();

function tzOffsetMinutes(d: Date, timeZone: string): number {
  // Render `d` in `timeZone` as wall-clock parts, then reinterpret
  // those parts as if they were UTC. The difference between that
  // synthetic UTC and the real Date is the TZ offset at that moment.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const pick = (t: string): number => {
    const v = parts.find((p) => p.type === t)?.value;
    return v ? Number(v) : 0;
  };
  const asUtcMs = Date.UTC(
    pick("year"),
    pick("month") - 1,
    pick("day"),
    pick("hour") % 24,  // Intl emits 24 for midnight on some runtimes
    pick("minute"),
    pick("second"),
  );
  return (asUtcMs - d.getTime()) / 60_000;
}

export function cityLocalToUtcIso(localStr: string | undefined | null, timeZone: string): string {
  if (!localStr) return ZERO_ISO;
  // Normalize the input: collapse "YYYY-MM-DD HH:MM:SS" to ISO form
  // and strip a stray `+00` / `Z` suffix that some feeds DO emit.
  const cleaned = String(localStr).trim().replace(" ", "T");
  // If the string already has a TZ marker (Z, +HH, -HH, +HH:MM), trust
  // it and just normalize to a Date roundtrip.
  if (/[zZ]$|[+-]\d{2}(:\d{2})?$/.test(cleaned)) {
    const d = new Date(cleaned);
    return isNaN(d.getTime()) ? ZERO_ISO : d.toISOString();
  }
  // Parse the wall-clock as if it were UTC. The resulting Date has
  // the correct wall-clock fields but the wrong actual instant.
  const asIfUtc = new Date(cleaned + "Z");
  if (isNaN(asIfUtc.getTime())) return ZERO_ISO;
  const offsetMin = tzOffsetMinutes(asIfUtc, timeZone);
  // If `tz` is UTC-7 (PDT), offsetMin = -420. The actual UTC moment is
  // wall-clock + 7h = asIfUtc - (-420 min) = asIfUtc + 420 min.
  return new Date(asIfUtc.getTime() - offsetMin * 60_000).toISOString();
}

/// Map of supported-city slug → IANA timezone. Adapters look up their
/// own timezone here so each adapter declares one line instead of
/// hand-rolling the offset math per call site.
export const CITY_TIMEZONES: Record<string, string> = {
  "san-diego": "America/Los_Angeles",
  "los-angeles": "America/Los_Angeles",
  "san-francisco": "America/Los_Angeles",
  "oakland": "America/Los_Angeles",
  "sacramento": "America/Los_Angeles",
  "seattle": "America/Los_Angeles",
  "las-vegas": "America/Los_Angeles",
  "fort-worth": "America/Chicago",
  "tucson": "America/Phoenix",
  "denver": "America/Denver",
  "colorado-springs": "America/Denver",
  "boise": "America/Boise",
  "chicago": "America/Chicago",
  "minneapolis": "America/Chicago",
  "saint-paul": "America/Chicago",
  "milwaukee": "America/Chicago",
  "kansas-city": "America/Chicago",
  "new-orleans": "America/Chicago",
  "baton-rouge": "America/Chicago",
  "dallas": "America/Chicago",
  "baltimore": "America/New_York",
  "new-york": "America/New_York",
  "boston": "America/New_York",
  "cambridge": "America/New_York",
  "philadelphia": "America/New_York",
  "pittsburgh": "America/New_York",
  "buffalo": "America/New_York",
  "detroit": "America/New_York",
  "cleveland": "America/New_York",
  "cincinnati": "America/New_York",
  "indianapolis": "America/Indiana/Indianapolis",
  "washington-dc": "America/New_York",
  "atlanta": "America/New_York",
  "charlotte": "America/New_York",
  "raleigh": "America/New_York",
  "norfolk": "America/New_York",
  "honolulu": "Pacific/Honolulu",
};
