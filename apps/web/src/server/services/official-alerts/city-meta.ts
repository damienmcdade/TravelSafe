// Server-safe city metadata for official-alerts adapters. We can't
// import `CITIES` from `@/lib/use-city` here because that module is
// "use client" and a Next.js server route running on Fluid Compute
// can't pull its bundle at runtime — production returned a 500 from
// /api/official-alerts the moment we tried. This is a focused
// duplicate of just the fields the official-alerts pipeline needs:
// USPS state code (for NWS state-area pulls) and city centroid (for
// USGS earthquake radius queries).

export interface OfficialAlertsCityMeta {
  slug: string;
  label: string;
  state: string;
  centroid: { lat: number; lng: number };
}

export const OFFICIAL_ALERTS_CITY_META: Record<string, OfficialAlertsCityMeta> = {
  "san-diego":         { slug: "san-diego",         label: "San Diego",         state: "CA", centroid: { lat: 32.78, lng: -117.18 } },
  "los-angeles":       { slug: "los-angeles",       label: "Los Angeles",       state: "CA", centroid: { lat: 34.05, lng: -118.32 } },
  "san-francisco":     { slug: "san-francisco",     label: "San Francisco",     state: "CA", centroid: { lat: 37.76, lng: -122.44 } },
  "oakland":           { slug: "oakland",           label: "Oakland",           state: "CA", centroid: { lat: 37.80, lng: -122.27 } },
  "chicago":           { slug: "chicago",           label: "Chicago",           state: "IL", centroid: { lat: 41.88, lng: -87.63 } },
  "new-york":          { slug: "new-york",          label: "New York City",     state: "NY", centroid: { lat: 40.71, lng: -74.01 } },
  "seattle":           { slug: "seattle",           label: "Seattle",           state: "WA", centroid: { lat: 47.61, lng: -122.33 } },
  "boston":            { slug: "boston",            label: "Boston",            state: "MA", centroid: { lat: 42.36, lng: -71.06 } },
  "cambridge":         { slug: "cambridge",         label: "Cambridge",         state: "MA", centroid: { lat: 42.375, lng: -71.105 } },
  "philadelphia":      { slug: "philadelphia",      label: "Philadelphia",      state: "PA", centroid: { lat: 39.95, lng: -75.17 } },
  "cincinnati":        { slug: "cincinnati",        label: "Cincinnati",        state: "OH", centroid: { lat: 39.10, lng: -84.51 } },
  "new-orleans":       { slug: "new-orleans",       label: "New Orleans",       state: "LA", centroid: { lat: 29.95, lng: -90.07 } },
  "baton-rouge":       { slug: "baton-rouge",       label: "Baton Rouge",       state: "LA", centroid: { lat: 30.44, lng: -91.13 } },
  "dallas":            { slug: "dallas",            label: "Dallas",            state: "TX", centroid: { lat: 32.78, lng: -96.80 } },
  "colorado-springs":  { slug: "colorado-springs",  label: "Colorado Springs",  state: "CO", centroid: { lat: 38.835, lng: -104.825 } },
  "detroit":           { slug: "detroit",           label: "Detroit",           state: "MI", centroid: { lat: 42.33, lng: -83.05 } },
  "washington-dc":     { slug: "washington-dc",     label: "Washington",        state: "DC", centroid: { lat: 38.90, lng: -77.04 } },
  "fort-worth":        { slug: "fort-worth",        label: "Fort Worth",        state: "TX", centroid: { lat: 32.73, lng: -97.32 } },
  "phoenix":           { slug: "phoenix",           label: "Phoenix",           state: "AZ", centroid: { lat: 33.4484, lng: -112.0740 } },
  "jacksonville":      { slug: "jacksonville",      label: "Jacksonville",      state: "FL", centroid: { lat: 30.33, lng: -81.66 } },
  "virginia-beach":    { slug: "virginia-beach",    label: "Virginia Beach",    state: "VA", centroid: { lat: 36.85, lng: -76.04 } },
  "gainesville":       { slug: "gainesville",       label: "Gainesville",       state: "FL", centroid: { lat: 29.65, lng: -82.32 } },
  "tampa":             { slug: "tampa",             label: "Tampa",             state: "FL", centroid: { lat: 27.95, lng: -82.46 } },
  "nashville":         { slug: "nashville",         label: "Nashville",         state: "TN", centroid: { lat: 36.16, lng: -86.78 } },
  "houston":           { slug: "houston",           label: "Houston",           state: "TX", centroid: { lat: 29.76, lng: -95.37 } },
  "montgomery-county":     { slug: "montgomery-county",     label: "Montgomery County",      state: "MD", centroid: { lat: 39.14, lng: -77.20 } },
  "prince-georges-county": { slug: "prince-georges-county", label: "Prince George's County", state: "MD", centroid: { lat: 38.83, lng: -76.88 } },
  "atlanta":           { slug: "atlanta",           label: "Atlanta",           state: "GA", centroid: { lat: 33.75, lng: -84.39 } },
  "minneapolis":       { slug: "minneapolis",       label: "Minneapolis",       state: "MN", centroid: { lat: 44.98, lng: -93.27 } },
  "kansas-city":       { slug: "kansas-city",       label: "Kansas City",       state: "MO", centroid: { lat: 39.10, lng: -94.58 } },
  "charlotte":         { slug: "charlotte",         label: "Charlotte",         state: "NC", centroid: { lat: 35.23, lng: -80.84 } },
  "milwaukee":         { slug: "milwaukee",         label: "Milwaukee",         state: "WI", centroid: { lat: 43.04, lng: -87.91 } },
  "baltimore":         { slug: "baltimore",         label: "Baltimore",         state: "MD", centroid: { lat: 39.29, lng: -76.61 } },
  "indianapolis":      { slug: "indianapolis",      label: "Indianapolis",      state: "IN", centroid: { lat: 39.77, lng: -86.16 } },
  "las-vegas":         { slug: "las-vegas",         label: "Las Vegas",         state: "NV", centroid: { lat: 36.17, lng: -115.14 } },
  "cleveland":         { slug: "cleveland",         label: "Cleveland",         state: "OH", centroid: { lat: 41.50, lng: -81.69 } },
  "norfolk":           { slug: "norfolk",           label: "Norfolk",           state: "VA", centroid: { lat: 36.85, lng: -76.28 } },
  // Added so every served city resolves here — without an entry a city gets NO
  // official alerts (weather / earthquake / AMBER / road conditions) at all.
  "boise":             { slug: "boise",             label: "Boise",             state: "ID", centroid: { lat: 43.62, lng: -116.20 } },
  "buffalo":           { slug: "buffalo",           label: "Buffalo",           state: "NY", centroid: { lat: 42.89, lng: -78.88 } },
  "denver":            { slug: "denver",            label: "Denver",            state: "CO", centroid: { lat: 39.74, lng: -104.99 } },
  "honolulu":          { slug: "honolulu",          label: "Honolulu",          state: "HI", centroid: { lat: 21.31, lng: -157.86 } },
  "long-beach":        { slug: "long-beach",        label: "Long Beach",        state: "CA", centroid: { lat: 33.77, lng: -118.19 } },
  "pittsburgh":        { slug: "pittsburgh",        label: "Pittsburgh",        state: "PA", centroid: { lat: 40.44, lng: -80.00 } },
  "sacramento":        { slug: "sacramento",        label: "Sacramento",        state: "CA", centroid: { lat: 38.58, lng: -121.49 } },
  "saint-paul":        { slug: "saint-paul",        label: "Saint Paul",        state: "MN", centroid: { lat: 44.95, lng: -93.09 } },
  "dayton":            { slug: "dayton",            label: "Dayton",            state: "OH", centroid: { lat: 39.76, lng: -84.19 } },
  "rochester":         { slug: "rochester",         label: "Rochester",         state: "NY", centroid: { lat: 43.16, lng: -77.61 } },
  "raleigh":           { slug: "raleigh",           label: "Raleigh",           state: "NC", centroid: { lat: 35.78, lng: -78.64 } },
  "grand-rapids":      { slug: "grand-rapids",      label: "Grand Rapids",      state: "MI", centroid: { lat: 42.96, lng: -85.67 } },
  "arlington":         { slug: "arlington",         label: "Arlington",         state: "TX", centroid: { lat: 32.74, lng: -97.11 } },
  "riverside":         { slug: "riverside",         label: "Riverside",         state: "CA", centroid: { lat: 33.95, lng: -117.40 } },
};
