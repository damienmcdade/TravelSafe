"use client";
import dynamic from "next/dynamic";
import { useCity } from "@/lib/use-city";

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
};

export default function MapPage() {
  const { city } = useCity();
  return (
    <main className="space-y-6">
      <header className="page-hero">
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Crime Map · {city.label}</p>
        <h1 className="mt-1 font-display text-3xl sm:text-4xl text-slate2-900">
          Where recent police reports are <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x">concentrated in {city.label}</span>
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
