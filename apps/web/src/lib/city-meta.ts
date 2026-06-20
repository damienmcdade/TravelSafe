// Client-safe city metadata mirror. Client components (e.g. TimeOfDayCard) need
// the area-slug→city prefix map, the city→IANA-timezone map, and the date-only
// set, but they CANNOT import the "server-only" @travelsafe/crime-data package.
// This module is the single client-side copy of those three tables, kept in
// lockstep with the canonical server definitions by a guard test
// (apps/api/tests/city-meta-drift.test.ts) that fails if they drift:
//   - AREA_SLUG_PREFIX   ⟷ packages/crime-data/src/cities.ts AREA_SLUG_PREFIX
//   - CITY_TZ            ⟷ packages/crime-data/src/lib/city-time.ts CITY_TIMEZONES (CITIES only)
//   - DATE_ONLY_SLUGS    ⟷ packages/crime-data/src/lib/city-time.ts DATE_ONLY_CITY_SLUGS
// History: TimeOfDayCard hand-maintained its own drifted copies, which had wrong
// prefixes for 7 live cities (boise/denver/charlotte/pittsburgh/minneapolis/
// honolulu/baton-rouge) and omitted the 4 newest — so their "when incidents
// happen" histogram silently fell back to UTC (off by 5-10h). Centralizing here
// + the guard test prevents that class of bug.

// Area-slug routing prefix per city (san-diego is "" — its slugs are bare).
export const AREA_SLUG_PREFIX: Record<string, string> = {
  "san-diego": "",
  "los-angeles": "la-", "san-francisco": "sf-", "chicago": "chi-", "seattle": "sea-",
  "new-york": "ny-", "colorado-springs": "cosp-", "detroit": "det-", "washington-dc": "dc-",
  "boston": "bos-", "philadelphia": "phl-", "oakland": "oak-", "cincinnati": "cin-",
  "new-orleans": "nola-", "baton-rouge": "br-", "cambridge": "cam-", "dallas": "dal-",
  "charlotte": "clt-", "baltimore": "balt-", "minneapolis": "mpls-", "cleveland": "cle-",
  "milwaukee": "mke-", "las-vegas": "lv-", "boise": "bzi-", "buffalo": "buf-", "norfolk": "nor-",
  "kansas-city": "kc-", "saint-paul": "sp-", "pittsburgh": "pgh-", "fort-worth": "fw-",
  "denver": "den-", "sacramento": "sac-", "atlanta": "atl-", "indianapolis": "indy-",
  "honolulu": "hnl-", "long-beach": "lb-", "phoenix": "phx-", "jacksonville": "jax-",
  "virginia-beach": "vb-", "gainesville": "gnv-", "tampa": "tpa-", "nashville": "bna-",
  "houston": "hou-", "montgomery-county": "moco-", "prince-georges-county": "pg-",
  "dayton": "day-",
};

// City → IANA timezone (the 45 live jurisdictions).
export const CITY_TZ: Record<string, string> = {
  "san-diego": "America/Los_Angeles", "los-angeles": "America/Los_Angeles",
  "san-francisco": "America/Los_Angeles", "oakland": "America/Los_Angeles",
  "sacramento": "America/Los_Angeles", "seattle": "America/Los_Angeles",
  "las-vegas": "America/Los_Angeles", "long-beach": "America/Los_Angeles",
  "fort-worth": "America/Chicago", "phoenix": "America/Phoenix",
  "jacksonville": "America/New_York", "virginia-beach": "America/New_York",
  "gainesville": "America/New_York", "tampa": "America/New_York",
  "denver": "America/Denver", "colorado-springs": "America/Denver", "boise": "America/Boise",
  "chicago": "America/Chicago", "minneapolis": "America/Chicago", "saint-paul": "America/Chicago",
  "milwaukee": "America/Chicago", "kansas-city": "America/Chicago", "new-orleans": "America/Chicago",
  "baton-rouge": "America/Chicago", "nashville": "America/Chicago", "houston": "America/Chicago",
  "dallas": "America/Chicago",
  "montgomery-county": "America/New_York", "prince-georges-county": "America/New_York",
  "baltimore": "America/New_York", "new-york": "America/New_York", "boston": "America/New_York",
  "cambridge": "America/New_York", "philadelphia": "America/New_York", "pittsburgh": "America/New_York",
  "buffalo": "America/New_York", "detroit": "America/New_York", "cleveland": "America/New_York",
  "cincinnati": "America/New_York", "indianapolis": "America/Indiana/Indianapolis",
  "washington-dc": "America/New_York", "atlanta": "America/New_York", "charlotte": "America/New_York",
  "norfolk": "America/New_York", "honolulu": "Pacific/Honolulu",
  "dayton": "America/New_York",
};

// Cities whose feed publishes date-only timestamps (no real hour-of-day).
export const DATE_ONLY_SLUGS: ReadonlySet<string> = new Set([
  "san-diego", "charlotte", "indianapolis", "dallas", "norfolk", "tampa",
  "houston", "prince-georges-county",
]);

// Prefix lookup ordered longest-first so e.g. "pgh-" (pittsburgh) is tested
// before "pg-" (prince-georges-county) can mis-match — though they're already
// mutually exclusive, longest-first is the safe general rule.
const PREFIX_PAIRS: Array<[string, string]> = Object.entries(AREA_SLUG_PREFIX)
  .filter(([, p]) => p !== "")
  .sort((a, b) => b[1].length - a[1].length);

/// Resolve an area slug to its city slug: the slug IS a city slug (citywide
/// view), or it carries one of the known prefixes. Returns null if unknown.
export function citySlugForArea(areaSlug: string): string | null {
  if (CITY_TZ[areaSlug]) return areaSlug;
  for (const [city, prefix] of PREFIX_PAIRS) {
    if (areaSlug.startsWith(prefix)) return city;
  }
  return null;
}

/// IANA timezone for an area slug; "UTC" only for a genuinely unknown slug.
export function tzForAreaSlug(areaSlug: string): string {
  const city = citySlugForArea(areaSlug);
  return (city && CITY_TZ[city]) || "UTC";
}

/// Whether the area's city publishes date-only timestamps.
export function isDateOnlyArea(areaSlug: string): boolean {
  const city = citySlugForArea(areaSlug);
  return city != null && DATE_ONLY_SLUGS.has(city);
}
