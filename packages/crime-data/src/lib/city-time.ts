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

/// Normalize a US slash-style date ("MM/DD/YYYY" or "M/D/YYYY",
/// optionally followed by " HH:MM[:SS]") into ISO "YYYY-MM-DDTHH:MM:SS".
/// Several ArcGIS string-date feeds (e.g. Sacramento's `Occurrence_Date_PT`
/// = "12/31/2025 23:38") publish this format. `new Date()` happens to
/// parse it, but `cityLocalToUtcIso`'s `+ "Z"` trick does NOT (an invalid
/// ISO string yields NaN → epoch-0), so we canonicalize here first.
/// Returns the input unchanged when it doesn't match the slash pattern.
function normalizeSlashDate(s: string): string {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return s;
  const [, mm, dd, yyyy, hh, mi, ss] = m;
  const p2 = (v: string) => v.padStart(2, "0");
  const time = hh ? `T${p2(hh)}:${mi}:${ss ?? "00"}` : "T00:00:00";
  return `${yyyy}-${p2(mm)}-${p2(dd)}${time}`;
}

export function cityLocalToUtcIso(localStr: string | undefined | null, timeZone: string): string {
  if (!localStr) return ZERO_ISO;
  // Normalize the input: accept US slash dates, collapse
  // "YYYY-MM-DD HH:MM:SS" to ISO form, and strip a stray `+00` / `Z`
  // suffix that some feeds DO emit.
  const cleaned = normalizeSlashDate(String(localStr).trim()).replace(" ", "T");
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
  "phoenix": "America/Phoenix",
  "jacksonville": "America/New_York",
  "virginia-beach": "America/New_York",
  "gainesville": "America/New_York",
  "tampa": "America/New_York",
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
  "nashville": "America/Chicago",
  "houston": "America/Chicago",
  "montgomery-county": "America/New_York",
  "prince-georges-county": "America/New_York",
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
  "norfolk": "America/New_York",
  "honolulu": "Pacific/Honolulu",
  "long-beach": "America/Los_Angeles",
  "dayton": "America/New_York",
  "rochester": "America/New_York",
  "raleigh": "America/New_York",
  "grand-rapids": "America/Detroit",
  "riverside": "America/Los_Angeles",
  "savannah": "America/New_York",
  "corpus-christi": "America/Chicago",
};

const _hourFmtCache = new Map<string, Intl.DateTimeFormat>();

/// Hour-of-day (0-23) of a UTC instant as read on the wall clock of
/// `timeZone`. Server-side mirror of the client TimeOfDayCard's
/// `hourInTz` — used so the trend-feed's time-of-day analysis buckets
/// by the *city's* local clock instead of the runtime's (which on
/// Railway/Vercel is UTC, shifting every "peak hour" by the offset).
export function cityLocalHour(iso: string, timeZone: string): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  let fmt = _hourFmtCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false });
    _hourFmtCache.set(timeZone, fmt);
  }
  const raw = Number(fmt.format(d));
  if (!Number.isFinite(raw)) return 0;
  return raw === 24 ? 0 : raw;
}

/// Cities whose upstream police feed publishes incident DATES with no
/// time-of-day component (date-only, or a date stored at local midnight).
/// For these the hour-of-day histogram is fabricated — every incident
/// collapses into a single bucket — so the "When incidents happen" card
/// and the trend-feed time-of-day insight suppress themselves and say so
/// instead of showing a misleading spike. Verified 2026-05-31 by sampling
/// each live feed:
///   - san-diego  : SDPD NIBRS `occured_on` = "2024-07-27" (date-only)
///   - charlotte  : CMPD `DATE_INCIDENT_BEGAN` = epoch at local midnight
///   - indianapolis: IMPD `sOccDate` = "2026-05-30" (date-only string)
///   - dallas     : DPD `date1` = "2026-05-30 00:00:00" (always midnight)
///   - norfolk    : `date_occu` always midnight (a real hour lives in the
///                  separate `hour_occu` field but isn't currently merged)
export const DATE_ONLY_CITY_SLUGS: ReadonlySet<string> = new Set([
  "san-diego",
  "charlotte",
  "indianapolis",
  "dallas",
  "norfolk",
  "tampa",
  // Houston HPD NIBRS yearly file is date-only (HPD_Occurrence_Date carries no
  // hour — every incident reads 00:00:00), so the hour-of-day histogram would
  // fabricate a midnight spike. Same honest "date only" treatment.
  "houston",
  // Prince George's County PGPD feed publishes date-only timestamps (all
  // 00:00:00) — surface the honest "date only" message instead of a fabricated
  // midnight time-of-day spike. (Montgomery County's start_date DOES carry real
  // times, so it is intentionally NOT listed here.)
  "prince-georges-county",
]);
