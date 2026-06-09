// v95p26 — slug→label-only lookup for OG image and other thin
// surfaces. Pre-v95p26 the city OG image routes imported cityBySlug
// from @travelsafe/crime-data/cities, which transitively pulled in
// every adapter (including Honolulu's 4124-address JSON). That made
// the Edge bundle blow past Vercel's 2 MB limit. Switching the OG
// routes to nodejs runtime fit the size limit but broke ImageResponse
// at request time (500 errors).
//
// This module is the smallest possible substitute: just slug → label
// for the 45 supported jurisdictions, no adapter imports, edge-safe. Lives
// here rather than the server services layer so client + edge code
// can both import without dragging in server-only deps. Must cover every
// CITIES slug or the OG social-share image renders a literal "City" headline.

export const CITY_LABEL_BY_SLUG: Record<string, string> = {
  "san-diego": "San Diego",
  "los-angeles": "Los Angeles",
  "san-francisco": "San Francisco",
  "chicago": "Chicago",
  "seattle": "Seattle",
  "new-york": "New York City",
  "colorado-springs": "Colorado Springs",
  "detroit": "Detroit",
  "washington-dc": "Washington",
  "boston": "Boston",
  "philadelphia": "Philadelphia",
  "oakland": "Oakland",
  "cincinnati": "Cincinnati",
  "new-orleans": "New Orleans",
  "baton-rouge": "Baton Rouge",
  "cambridge": "Cambridge",
  "dallas": "Dallas",
  "charlotte": "Charlotte",
  "baltimore": "Baltimore",
  "minneapolis": "Minneapolis",
  "cleveland": "Cleveland",
  "milwaukee": "Milwaukee",
  "las-vegas": "Las Vegas",
  "boise": "Boise",
  "buffalo": "Buffalo",
  "norfolk": "Norfolk",
  "kansas-city": "Kansas City",
  "saint-paul": "Saint Paul",
  "pittsburgh": "Pittsburgh",
  "fort-worth": "Fort Worth",
  "denver": "Denver",
  "sacramento": "Sacramento",
  "atlanta": "Atlanta",
  "indianapolis": "Indianapolis",
  "honolulu": "Honolulu",
  "long-beach": "Long Beach",
  "phoenix": "Phoenix",
  "jacksonville": "Jacksonville",
  "virginia-beach": "Virginia Beach",
  "gainesville": "Gainesville",
  "tampa": "Tampa",
  "nashville": "Nashville",
  "houston": "Houston",
  "montgomery-county": "Montgomery County",
  "prince-georges-county": "Prince George's County",
};

export function cityLabelBySlug(slug: string): string | null {
  return CITY_LABEL_BY_SLUG[slug] ?? null;
}
