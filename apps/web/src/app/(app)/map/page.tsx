"use client";
import dynamic from "next/dynamic";
import { useCity } from "@/lib/use-city";
import { useArea } from "@/lib/use-area";
import { useDocumentTitle } from "@/lib/use-document-title";

const CrimeMap = dynamic(() => import("./CrimeMap"), {
  ssr: false,
  loading: () => (
    <div className="surface h-[62vh] min-h-[460px] flex items-center justify-center text-slate2-500 animate-pulse">
      Loading map…
    </div>
  ),
});

// Plain-English, user-facing data-source captions. We deliberately keep these
// jargon-free (no NIBRS / ArcGIS / Socrata / "patrol division" / field names) —
// just the city, what the data is, how it's grouped, and the official open-data
// source. Legally-required attributions (e.g. OpenStreetMap) are kept verbatim.
const SOURCES: Record<string, string> = {
  "san-diego":     "San Diego police crime reports, from the City of San Diego open-data site.",
  "los-angeles":   "Los Angeles police crime reports (2020 to today), from the City of Los Angeles open-data site.",
  "san-francisco": "San Francisco police incident reports (2018 to today), from the DataSF open-data site.",
  "chicago":       "Chicago police crime reports (2001 to today), from the City of Chicago open-data site.",
  "seattle":       "Seattle police crime reports, from the City of Seattle open-data site.",
  "new-york":      "New York City police complaint reports (this year so far), grouped by precinct, from the NYC open-data site.",
  "colorado-springs": "Colorado Springs police crime reports, grouped by police district, from the city's open-data site.",
  "detroit":       "Detroit police crime reports, grouped by neighborhood, from the City of Detroit open-data site.",
  "washington-dc": "Washington DC police crime reports (last 30 days), grouped by neighborhood, from the Open Data DC site.",
  "boston":        "Boston police crime reports, grouped by district, from the City of Boston open-data site.",
  "philadelphia":  "Philadelphia police crime reports, grouped by district, from the OpenDataPhilly site.",
  "oakland":       "Oakland police crime reports, placed into named neighborhoods, from the City of Oakland open-data site.",
  "cincinnati":    "Cincinnati police crime reports, grouped by neighborhood, from the City of Cincinnati open-data site.",
  "new-orleans":   "New Orleans 911 call records, placed into named neighborhoods, from the city's open-data site. Some calls turn out not to be crimes.",
  "baton-rouge":   "Baton Rouge police crime reports, from the City of Baton Rouge open-data site.",
  "cambridge":     "Cambridge police crime reports, grouped by neighborhood, from the City of Cambridge open-data site.",
  "dallas":        "Dallas police incident reports, placed into named neighborhoods, from the City of Dallas open-data site. Personal details are left out.",
  "charlotte":     "Charlotte police reports, placed into named neighborhoods, from the City of Charlotte open-data site. Neighborhood boundaries © OpenStreetMap contributors.",
  "baltimore":     "Baltimore police crime reports, grouped into the city's 283 official neighborhoods, from the Open Baltimore site. Victim details are left out.",
  "fort-worth":    "Fort Worth police crime reports, placed into 384 official neighborhoods, from the City of Fort Worth open-data site.",
  "minneapolis":   "Minneapolis police crime reports, grouped into 87 named neighborhoods, from the City of Minneapolis open-data site.",
  "cleveland":     "Cleveland police 911 call records, grouped by neighborhood, from the City of Cleveland open-data site. Some calls turn out not to be crimes.",
  "milwaukee":     "Milwaukee police crime reports, placed into city neighborhoods by approximate location, from the City of Milwaukee open-data site.",
  "las-vegas":     "Las Vegas police 911 call records, placed into 26 named neighborhoods, from the city's open-data site. Some calls turn out not to be crimes.",
  "boise":         "Boise police 911 call records, grouped into 35 official neighborhood associations, from the City of Boise open-data site.",
  "buffalo":       "Buffalo police crime reports, grouped into 36 official neighborhoods, from the Open Data Buffalo site.",
  "norfolk":       "Norfolk police incident reports, grouped into about 50 named neighborhoods, from the City of Norfolk open-data site.",
  "kansas-city":   "Kansas City police crime reports, placed into 145 named neighborhoods, from the Open Data KC site. Personal details are left out.",
  "saint-paul":    "Saint Paul police crime reports, grouped into 17 planning districts, from the City of Saint Paul open-data site.",
  "pittsburgh":    "Pittsburgh police crime reports, grouped into 90 official neighborhoods, from the WPRDC open-data site.",
  "nashville":     "Nashville police crime reports, placed into named neighborhoods, from the Metro Nashville open-data site. Neighborhood boundaries © OpenStreetMap contributors.",
  "houston":       "Houston police crime reports (data through 2024), placed into named neighborhoods, from the City of Houston open-data site. Neighborhood boundaries © OpenStreetMap contributors.",
  "montgomery-county": "Montgomery County police crime reports, placed into the county's towns and communities (Silver Spring, Rockville, Bethesda…), from the Data Montgomery open-data site. Community boundaries © US Census Bureau.",
  "prince-georges-county": "Prince George's County police crime reports, placed into the county's towns and communities (Bowie, College Park, Hyattsville…), from the county's open-data site. Community boundaries © US Census Bureau.",
  "denver":        "Denver police crime reports, grouped by neighborhood, from the City of Denver open-data site.",
  "sacramento":    "Sacramento police crime reports, grouped by neighborhood, from the City of Sacramento open-data site.",
  "atlanta":       "Atlanta police crime reports, grouped by neighborhood, from the Atlanta Police Department open-data site.",
  "indianapolis":  "Indianapolis Metro police crime reports, grouped by district, from the city's open-data site.",
  "honolulu":      "Honolulu police crime reports, grouped by area, from the City and County of Honolulu open-data site.",
  "long-beach":    "Long Beach police crime reports, placed into named neighborhoods, from the City of Long Beach open-data site.",
  "phoenix":       "Phoenix police crime reports, grouped into the city's urban villages, from the Phoenix open-data site (data through December 2025).",
  "jacksonville":  "Jacksonville Sheriff's Office crime reports, placed into named neighborhoods, from the JSO open-data site.",
  "virginia-beach": "Virginia Beach police incident reports, grouped into planning areas, from the City of Virginia Beach open-data site.",
  "gainesville":   "Gainesville police crime reports, placed into named neighborhoods, from the City of Gainesville open-data site.",
  "tampa":         "Tampa police crime reports (last 365 days), placed into named neighborhoods, from the City of Tampa open-data site.",
};

export default function MapPage() {
  const { city } = useCity();
  const { area } = useArea(city.slug);
  useDocumentTitle(`Crime Map · ${area?.label ?? city.label}`);
  return (
    <div className="space-y-6">
      {/* Warm DNS + TCP + TLS to CartoDB's tile servers in parallel with the
          dynamic-imported Leaflet bundle. Leaflet round-robins across four
          subdomains (a/b/c/d) so preconnecting to two gives us parallel
          early connections without burning all four browser connection
          slots. React 19 hoists these <link>s into <head> automatically. */}
      <link rel="preconnect" href="https://a.basemaps.cartocdn.com" crossOrigin="" />
      <link rel="preconnect" href="https://c.basemaps.cartocdn.com" crossOrigin="" />
      <header className="page-hero">
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Crime Map · {city.label}</p>
        <h1 className="mt-1 font-display text-3xl sm:text-4xl leading-tight text-slate2-900">
          Where recent police reports are <span className="bg-title-stripe bg-clip-text text-transparent break-words">concentrated in {city.label}</span>
        </h1>
        <p className="mt-2 text-slate2-700 max-w-2xl">
          Each {city.label} neighborhood is shaded by the mix of recent incidents reported there. Colors blend together when more than one category is present, so a neighborhood with mostly property crime but some violent crime reads as a warmer orange. Type a neighborhood name above the map to zoom in and see the individual offenses inside it.
        </p>
      </header>
      <CrimeMap />
      <p className="text-xs text-slate2-500">
        Data source for {city.label}: {SOURCES[city.slug] ?? "city open-data portal."} Map tiles are served by CARTO with OpenStreetMap contributors.
      </p>
    </div>
  );
}
