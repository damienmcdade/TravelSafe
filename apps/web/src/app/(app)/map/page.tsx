"use client";
import dynamic from "next/dynamic";

const CrimeMap = dynamic(() => import("./CrimeMap"), { ssr: false, loading: () => (
  <div className="surface h-[520px] flex items-center justify-center text-slate2-500 animate-pulse">
    Loading San Diego map…
  </div>
) });

export default function MapPage() {
  return (
    <main className="space-y-6">
      <header>
        <h1 className="font-display text-3xl text-slate2-900">Crime Map</h1>
        <p className="mt-1 text-slate2-500 max-w-2xl">
          Color-coded view of recent SDPD-reported incidents across San Diego neighborhoods.
          Circle size reflects incident volume in the cached window; color shows the dominant NIBRS category.
          This is area-level data — not live, never street-level.
        </p>
      </header>
      <CrimeMap />
      <p className="text-xs text-slate2-500">
        Source: SDPD NIBRS via the City of San Diego Open Data Portal (quarterly).
        Map tiles: © OpenStreetMap contributors.
      </p>
    </main>
  );
}
