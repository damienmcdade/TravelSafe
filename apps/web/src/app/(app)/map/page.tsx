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

const SOURCES: Record<string, string> = {
  "san-diego":     "San Diego Police Department NIBRS Crime Offenses (City of San Diego Open Data Portal).",
  "los-angeles":   "Los Angeles Police Department Crime Data, 2020 to present (City of Los Angeles Open Data).",
  "san-francisco": "San Francisco Police Department Incident Reports, 2018 to present (DataSF).",
  "chicago":       "Chicago Police Department Crimes 2001 to present (City of Chicago Open Data).",
  "seattle":       "Seattle Police Department Crime Data, NIBRS-coded (City of Seattle Open Data).",
  "new-york":      "New York City Police Department Complaint Data (current YTD), aggregated to NYPD precinct (NYC Open Data).",
  "colorado-springs": "CSPD Crime Level Data (Colorado Springs Open Data, Socrata), aggregated to CSPD patrol division.",
  "detroit":       "Detroit RMS Crime Incidents (City of Detroit Open Data, ArcGIS Feature Server), aggregated to named neighborhood.",
  "washington-dc": "DC MPD Crime Incidents — Last 30 Days (Open Data DC, ArcGIS MapServer), aggregated to neighborhood cluster.",
  "boston":        "Boston Police Department Crime Incident Reports (City of Boston Open Data, CKAN), aggregated to BPD district.",
  "philadelphia":  "Philadelphia Crime Incidents Part 1 & Part 2 (OpenDataPhilly, CARTO SQL), aggregated to PPD district.",
  "oakland":       "Oakland Police Department CrimeWatch Reports (City of Oakland Open Data), geocoded to named neighborhood.",
  "cincinnati":    "Cincinnati Police Department Crime Incidents (City of Cincinnati Open Data), aggregated to CPD neighborhood.",
  "new-orleans":   "NOPD Calls for Service 2026 (City of New Orleans Open Data), geocoded to named neighborhood. Includes non-crime dispatches.",
  "baton-rouge":   "Baton Rouge Police Crime Incidents (City of Baton Rouge Open Data). NIBRS-classified per row by BRPD.",
  "cambridge":     "Cambridge Police Crime Reports (City of Cambridge Open Data), aggregated to CDD neighborhood.",
  "dallas":        "Dallas Police Incidents (City of Dallas Open Data), geocoded to named neighborhood. Demographic columns are excluded at request time.",
  "charlotte":     "CMPD Incidents (City of Charlotte Open Data, ArcGIS MapServer), aggregated to CMPD patrol division.",
  "baltimore":     "Baltimore PD NIBRS Group A Crime Data (Open Baltimore, ArcGIS Feature Server), grouped to the city's 283 official neighborhoods. Victim-demographic columns are excluded at request time.",
  "fort-worth":    "Fort Worth PD Crime Data (City of Fort Worth GIS, ArcGIS MapServer), geocoded to 384 official Fort Worth neighborhoods (FWPD patrol division fallback). Texas Penal Code offenses are mapped to FBI Part-1 categories.",
  "minneapolis":   "Minneapolis Crime_Data (City of Minneapolis Open Data, ArcGIS Feature Server). NIBRS-classified per row by MPD, aggregated to one of 87 named neighborhoods.",
  "cleveland":     "Cleveland Division of Police Calls for Service (City of Cleveland Open Data, ArcGIS Feature Server). Administrative dispatches filtered at ingest. Includes non-NIBRS reports.",
  "milwaukee":     "Milwaukee Police WIBR Crime Data (data.milwaukee.gov, CKAN datastore). Per-incident boolean offense flags mapped to NIBRS PERSONS/PROPERTY; aggregated to ZIP-level neighborhood groupings.",
  "las-vegas":     "LVMPD Calls for Service (Opendata Las Vegas, ArcGIS Feature Server). Administrative dispatches and ambiguous calls filtered at ingest. Geocoded to one of 26 named Las Vegas neighborhoods.",
  "boise":         "Boise Police Calls for Service (City of Boise Open Data, ArcGIS). BPD's own Violent/Property/Society category labels are honored, aggregated to one of 35 official Boise neighborhood associations.",
  "buffalo":       "Buffalo Police Crime Incidents (Open Data Buffalo, Socrata). BPD's clean parent_incident_type taxonomy (Theft / Assault / Vehicle Theft / Breaking & Entering / Robbery / Sexual Offense / Homicide), aggregated to one of 36 official Buffalo neighborhoods.",
  "norfolk":       "Norfolk Police Incident Reports (data.norfolk.gov, Socrata). Full ~108k-incident dataset refreshed daily; aggregated to ~50 named Civic League neighborhoods via NPD's `neighborhd` tag. Replaced Tucson in May 2026 (TPD's only published feed was a rolling 45-day window with no historical alternative).",
  "kansas-city":   "KCPD Crime Data 2026 (Open Data KC, Socrata). Demographic columns excluded at request time; geocoded to one of 145 named Kansas City neighborhoods since KCPD's `area` field has only 6 patrol divisions.",
  "saint-paul":    "Saint Paul Crime Incident Report (City of Saint Paul Open Data, ArcGIS). Aggregated to one of 17 District Council planning districts; administrative entries (Proactive Police Visit, Community Event) filtered at ingest.",
  "pittsburgh":    "Pittsburgh Bureau of Police Monthly Criminal Activity (WPRDC, CKAN). NIBRS-classified per row by PBP and aggregated to one of 90 official Pittsburgh neighborhoods.",
};

export default function MapPage() {
  const { city } = useCity();
  const { area } = useArea(city.slug);
  useDocumentTitle(`Crime Map · ${area?.label ?? city.label}`);
  return (
    <main className="space-y-6">
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
          Where recent police reports are <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x break-words">concentrated in {city.label}</span>
        </h1>
        <p className="mt-2 text-slate2-700 max-w-2xl">
          Each {city.label} neighborhood is shaded by the mix of recent incidents reported there. Colors blend together when more than one category is present, so a neighborhood with mostly property crime but some violent crime reads as a warmer orange. Type a neighborhood name above the map to zoom in and see the individual offenses inside it.
        </p>
      </header>
      <CrimeMap />
      <p className="text-xs text-slate2-500">
        Data source for {city.label}: {SOURCES[city.slug] ?? "city open-data portal"} Map tiles are served by CARTO with OpenStreetMap contributors.
      </p>
    </main>
  );
}
