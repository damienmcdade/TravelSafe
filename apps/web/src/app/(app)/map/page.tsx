"use client";
import dynamic from "next/dynamic";

const CrimeMap = dynamic(() => import("./CrimeMap"), {
  ssr: false,
  loading: () => (
    <div className="surface h-[60vh] min-h-[440px] flex items-center justify-center text-slate2-500 animate-pulse">
      Loading San Diego map…
    </div>
  ),
});

export default function MapPage() {
  return (
    <main className="space-y-6">
      <header className="page-hero">
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Crime Map · San Diego</p>
        <h1 className="mt-1 font-display text-3xl sm:text-4xl text-slate2-900">
          Where SDPD reports are <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x">clustering right now</span>
        </h1>
        <p className="mt-2 text-slate2-700 max-w-2xl">
          Each circle is one San Diego neighborhood. Hover to see its persons / property / society breakdown,
          and compare with the ranked list below.
        </p>
      </header>
      <CrimeMap />
      <p className="text-xs text-slate2-500">
        Data: SDPD NIBRS via the City of San Diego Open Data Portal (refreshed quarterly).
        Map tiles: CARTO + OpenStreetMap contributors.
      </p>
    </main>
  );
}
