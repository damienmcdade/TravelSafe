// v99 — canonical city → US state map. State info had drifted across the
// app: the coverage dashboard's own STATE_BY_SLUG map was missing 8 live
// cities (denver, sacramento, atlanta, indianapolis, raleigh, norfolk,
// honolulu, long-beach) and rendered "—" for them. This module is the
// single source of truth, lives in the package (no adapter imports, so it's
// importable from server code AND tests), and is guarded by
// apps/api/tests/coverage-states.test.ts which asserts every city in the
// CITIES registry has an entry here. Add a row whenever a city is added.

export interface UsState {
  /// USPS abbreviation, e.g. "CA". ("DC" for the District of Columbia.)
  abbr: string;
  /// Full name shown in state selectors, e.g. "California".
  label: string;
}

export const CITY_STATES: Record<string, UsState> = {
  "san-diego":         { abbr: "CA", label: "California" },
  "los-angeles":       { abbr: "CA", label: "California" },
  "san-francisco":     { abbr: "CA", label: "California" },
  "oakland":           { abbr: "CA", label: "California" },
  "sacramento":        { abbr: "CA", label: "California" },
  "long-beach":        { abbr: "CA", label: "California" },
  "chicago":           { abbr: "IL", label: "Illinois" },
  "new-york":          { abbr: "NY", label: "New York" },
  "buffalo":           { abbr: "NY", label: "New York" },
  "seattle":           { abbr: "WA", label: "Washington" },
  "colorado-springs":  { abbr: "CO", label: "Colorado" },
  "denver":            { abbr: "CO", label: "Colorado" },
  "detroit":           { abbr: "MI", label: "Michigan" },
  "washington-dc":     { abbr: "DC", label: "District of Columbia" },
  "boston":            { abbr: "MA", label: "Massachusetts" },
  "cambridge":         { abbr: "MA", label: "Massachusetts" },
  "philadelphia":      { abbr: "PA", label: "Pennsylvania" },
  "pittsburgh":        { abbr: "PA", label: "Pennsylvania" },
  "cincinnati":        { abbr: "OH", label: "Ohio" },
  "cleveland":         { abbr: "OH", label: "Ohio" },
  "new-orleans":       { abbr: "LA", label: "Louisiana" },
  "baton-rouge":       { abbr: "LA", label: "Louisiana" },
  "dallas":            { abbr: "TX", label: "Texas" },
  "fort-worth":        { abbr: "TX", label: "Texas" },
  "charlotte":         { abbr: "NC", label: "North Carolina" },
  "raleigh":           { abbr: "NC", label: "North Carolina" },
  "baltimore":         { abbr: "MD", label: "Maryland" },
  "minneapolis":       { abbr: "MN", label: "Minnesota" },
  "saint-paul":        { abbr: "MN", label: "Minnesota" },
  "milwaukee":         { abbr: "WI", label: "Wisconsin" },
  "las-vegas":         { abbr: "NV", label: "Nevada" },
  "boise":             { abbr: "ID", label: "Idaho" },
  "tucson":            { abbr: "AZ", label: "Arizona" },
  "austin":            { abbr: "TX", label: "Texas" },
  "phoenix":           { abbr: "AZ", label: "Arizona" },
  "kansas-city":       { abbr: "MO", label: "Missouri" },
  "atlanta":           { abbr: "GA", label: "Georgia" },
  "indianapolis":      { abbr: "IN", label: "Indiana" },
  "norfolk":           { abbr: "VA", label: "Virginia" },
  "honolulu":          { abbr: "HI", label: "Hawaii" },
};

/// State abbreviation for a city slug, or "—" if unknown (the dash the
/// coverage UI shows when a city has no mapped state).
export function stateAbbrForCity(slug: string): string {
  return CITY_STATES[slug]?.abbr ?? "—";
}
