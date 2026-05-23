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
  "denver":            { slug: "denver",            label: "Denver",            state: "CO", centroid: { lat: 39.74, lng: -104.99 } },
  "detroit":           { slug: "detroit",           label: "Detroit",           state: "MI", centroid: { lat: 42.33, lng: -83.05 } },
  "washington-dc":     { slug: "washington-dc",     label: "Washington",        state: "DC", centroid: { lat: 38.90, lng: -77.04 } },
  "phoenix":           { slug: "phoenix",           label: "Phoenix",           state: "AZ", centroid: { lat: 33.45, lng: -112.07 } },
  "austin":            { slug: "austin",            label: "Austin",            state: "TX", centroid: { lat: 30.27, lng: -97.74 } },
  "atlanta":           { slug: "atlanta",           label: "Atlanta",           state: "GA", centroid: { lat: 33.75, lng: -84.39 } },
  "minneapolis":       { slug: "minneapolis",       label: "Minneapolis",       state: "MN", centroid: { lat: 44.98, lng: -93.27 } },
  "kansas-city":       { slug: "kansas-city",       label: "Kansas City",       state: "MO", centroid: { lat: 39.10, lng: -94.58 } },
  "charlotte":         { slug: "charlotte",         label: "Charlotte",         state: "NC", centroid: { lat: 35.23, lng: -80.84 } },
  "milwaukee":         { slug: "milwaukee",         label: "Milwaukee",         state: "WI", centroid: { lat: 43.04, lng: -87.91 } },
  "nashville":         { slug: "nashville",         label: "Nashville",         state: "TN", centroid: { lat: 36.16, lng: -86.78 } },
  "raleigh":           { slug: "raleigh",           label: "Raleigh",           state: "NC", centroid: { lat: 35.78, lng: -78.64 } },
  "indianapolis":      { slug: "indianapolis",      label: "Indianapolis",      state: "IN", centroid: { lat: 39.77, lng: -86.16 } },
  "las-vegas":         { slug: "las-vegas",         label: "Las Vegas",         state: "NV", centroid: { lat: 36.17, lng: -115.14 } },
  "cleveland":         { slug: "cleveland",         label: "Cleveland",         state: "OH", centroid: { lat: 41.50, lng: -81.69 } },
  "miami":             { slug: "miami",             label: "Miami",             state: "FL", centroid: { lat: 25.76, lng: -80.19 } },
};
