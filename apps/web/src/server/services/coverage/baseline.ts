import "server-only";

/// Static baseline of known-good per-city neighborhood counts +
/// source labels, captured from successful live coverage probes.
/// Used as the final fallback when the live probe times out AND no
/// in-memory last-known-good is available (e.g. on a cold Lambda
/// the first time it answers /api/coverage after deploy).
///
/// Why this exists: many adapters use a "fire-and-forget" cold-start
/// pattern (charlotte-arcgis.ts:209, atlanta-arcgis.ts:131) — first
/// call returns [] while the background warm pulls 60k+ rows. The
/// dashboard would surface that as "warming up · 0 neighborhoods"
/// for the user who tripped the cold start, even though the city
/// has been live for months and will be live ~30s later. The
/// baseline guarantees the dashboard always reports the city as
/// live with the prior known-good count. The freshness timestamp
/// reflects when the baseline was captured, not the live data.
///
/// Refresh procedure: when adding a new city or after a sustained
/// upstream schema change that materially changes the discovered
/// area count, hit `/api/coverage?cb=$(date +%s)` (cache-busting)
/// to force a fresh probe and update the numbers here. The numbers
/// don't need to be exact — they just need to be in the right
/// order of magnitude. If the live probe ever returns a HIGHER
/// number, the in-memory last-known-good takes precedence.

export interface BaselineEntry {
  neighborhoodCount: number;
  source: string;
}

export const COVERAGE_BASELINE: Record<string, BaselineEntry> = {
  // California
  "san-diego":        { neighborhoodCount: 125, source: "SDPD NIBRS Crime Offenses (City of San Diego Open Data)" },
  "los-angeles":      { neighborhoodCount: 114, source: "LAPD NIBRS Offenses 2026-to-Present + 2024-2025 (City of Los Angeles Open Data)" },
  "san-francisco":    { neighborhoodCount:  43, source: "SFPD Incident Reports (City of San Francisco Open Data)" },
  "oakland":          { neighborhoodCount: 130, source: "Oakland Police Department Crime Reports (City of Oakland Open Data)" },
  "sacramento":       { neighborhoodCount: 117, source: "City of Sacramento Report Data (Sacramento PD via Sacramento Open Data)" },
  // Pacific Northwest / Mountain
  "seattle":          { neighborhoodCount:  58, source: "Seattle Police Department Crime Data (City of Seattle Open Data)" },
  "boise":            { neighborhoodCount:  37, source: "Boise Police Department Calls for Service (City of Boise Open Data)" },
  "denver":           { neighborhoodCount:  77, source: "Denver Crime Offenses (Denver Open Data, ArcGIS Feature Server)" },
  "colorado-springs": { neighborhoodCount:  78, source: "Colorado Springs Police Department Crime Level Data (CSPD Open Data)" },
  "las-vegas":        { neighborhoodCount:  22, source: "Las Vegas Metropolitan Police Department Calls for Service (Opendata Las Vegas)" },
  "fort-worth":       { neighborhoodCount: 297, source: "FWPD Crime Data · City of Fort Worth GIS" },
  "phoenix":          { neighborhoodCount:  13, source: "Phoenix PD Crime Data (phoenixopendata.com, CKAN) — urban villages, through Dec 2025" },
  "jacksonville":     { neighborhoodCount: 208, source: "JSO NIBRS Incidents — Jacksonville Sheriff's Office (ArcGIS) — neighborhood-level" },
  "virginia-beach":   { neighborhoodCount: 333, source: "VBPD Police Incident Reports (data-vbgov.opendata.arcgis.com) — planning subdivisions" },
  "gainesville":      { neighborhoodCount: 114, source: "GPD Crime Responses (data.cityofgainesville.org, Socrata) — GNV neighborhoods (point-in-polygon)" },
  "tampa":            { neighborhoodCount: 117, source: "TPD Crimes last 365 days (City of Tampa GIS, ArcGIS) — neighborhood-level" },
  // Midwest
  "chicago":          { neighborhoodCount:  77, source: "Chicago Crimes 2001-Present (City of Chicago Open Data)" },
  "minneapolis":      { neighborhoodCount:  86, source: "Minneapolis Crime_Data (City of Minneapolis, ArcGIS Feature Server)" },
  "saint-paul":       { neighborhoodCount:  17, source: "Saint Paul Police Crime Incident Report (City of Saint Paul Open Data)" },
  "milwaukee":        { neighborhoodCount:  27, source: "Milwaukee Police WIBR Crime Data · data.milwaukee.gov" },
  "kansas-city":      { neighborhoodCount: 145, source: "Kansas City MO Police Crime Data — current + prior year (Open Data KC)" },
  "indianapolis":     { neighborhoodCount:   9, source: "Indianapolis Metropolitan Police Department Public Incidents (gis.indy.gov)" },
  "cincinnati":       { neighborhoodCount:  52, source: "Cincinnati Police Department Reported Crime (STARS)" },
  "cleveland":        { neighborhoodCount:  33, source: "Cleveland Division of Police — Part-1 Crime Incidents (NIBRS RMS)" },
  "detroit":          { neighborhoodCount: 208, source: "Detroit Police RMS Crime Incidents · data.detroitmi.gov" },
  // Texas / South
  "dallas":           { neighborhoodCount:  24, source: "Dallas Police Incidents (City of Dallas Open Data) — 24 area-sector polygons" },
  "baltimore":        { neighborhoodCount: 283, source: "BPD NIBRS Group A Crime Data · data.baltimorecity.gov" },
  "atlanta":          { neighborhoodCount:  25, source: "Atlanta Police Department Crime Incidents (Atlanta PD Open Data)" },
  "charlotte":        { neighborhoodCount: 203, source: "Charlotte-Mecklenburg Police Department Crime Incidents (charlottenc.gov ArcGIS) — named neighborhoods (point-in-polygon)" },
  "houston":          { neighborhoodCount: 266, source: "Houston Police Department NIBRS Crime (City of Houston Open Data, ArcGIS) — named neighborhoods (point-in-polygon), data through 2024" },
  "new-orleans":      { neighborhoodCount:  74, source: "NOPD Calls for Service 2026 (City of New Orleans Open Data)" },
  "baton-rouge":      { neighborhoodCount:  51, source: "Baton Rouge Police Crime Incidents (City of Baton Rouge Open Data)" },
  // Northeast / Mid-Atlantic
  "new-york":         { neighborhoodCount:  77, source: "NYPD Complaint Data Current Year-To-Date (NYC Open Data)" },
  "boston":           { neighborhoodCount:  12, source: "Boston Police Department Crime Incident Reports (City of Boston Open Data)" },
  "cambridge":        { neighborhoodCount:  13, source: "Cambridge Police Crime Reports (City of Cambridge Open Data)" },
  "philadelphia":     { neighborhoodCount:  21, source: "Philadelphia Crime Incidents Part 1 & Part 2 (OpenDataPhilly, CARTO)" },
  "pittsburgh":       { neighborhoodCount:  90, source: "Pittsburgh Bureau of Police Monthly Criminal Activity (Western PA RDC)" },
  "buffalo":          { neighborhoodCount:  35, source: "Buffalo Police Crime Incidents (Open Data Buffalo, Socrata)" },
  "washington-dc":    { neighborhoodCount:  51, source: "DC MPD Crime Incidents — Last 30 Days (Open Data DC, ArcGIS MapServer)" },
  "norfolk":          { neighborhoodCount: 122, source: "Norfolk Police Incident Reports (data.norfolk.gov, Socrata)" },
  "long-beach":       { neighborhoodCount:  74, source: "Long Beach Police Department Incidents (City of Long Beach Open Data, Socrata) — named neighborhoods (point-in-polygon)" },
  "nashville":        { neighborhoodCount: 180, source: "Metro Nashville Police Department Incidents (Metro Nashville Open Data, ArcGIS) — named neighborhoods (point-in-polygon)" },
  // Maryland counties
  "montgomery-county":     { neighborhoodCount:  58, source: "Montgomery County Police Department Crime (Data Montgomery, Socrata) — constituent communities (US Census places)" },
  "prince-georges-county": { neighborhoodCount:  75, source: "Prince George's County Police Department Reported Crime (PG Open Data, Socrata) — constituent communities (US Census places)" },
  // Pacific
  "honolulu":         { neighborhoodCount: 122, source: "Honolulu Police Department Incidents (data.honolulu.gov, Socrata)" },
};

/// Returns the static baseline entry for a city slug, or null when
/// the slug is unknown. Mostly used by coverage/status.ts as the
/// tertiary fallback after (1) live probe and (2) in-memory LKG.
export function baselineFor(slug: string): BaselineEntry | null {
  return COVERAGE_BASELINE[slug] ?? null;
}
