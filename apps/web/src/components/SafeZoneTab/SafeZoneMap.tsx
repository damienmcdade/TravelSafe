"use client";
import dynamic from "next/dynamic";
import Link from "next/link";

// We deliberately do NOT re-implement map initialization or polygon loading
// here — the canonical Crime Map module already handles that. This widget
// is a presentation wrapper: it dynamic-imports the existing CrimeMap so
// SSR doesn't try to render Leaflet, surrounds it with a header + a link to
// the full tab, and adds the standardized SafeZoneTab padding boundaries.
const CrimeMap = dynamic(() => import("../../app/(app)/map/CrimeMap"), {
  ssr: false,
  loading: () => (
    <div className="surface h-[48vh] min-h-[360px] flex items-center justify-center text-slate2-500 animate-pulse">
      Loading map…
    </div>
  ),
});

export interface SafeZoneMapProps {
  cityLabel: string;
  /// Optional title override. Defaults to "Map overlay — {cityLabel}".
  title?: string;
  /// When true, suppress the "Open full Crime Map" link in the header.
  /// Useful when this widget is rendered as a preview on a parent tab
  /// whose route already IS the full Crime Map.
  hideFullMapLink?: boolean;
}

/// Stateless wrapper around the canonical CrimeMap. Drops cleanly into any
/// host page that wants a map preview without forcing the host to wire up
/// Leaflet or fetch polygons itself.
export function SafeZoneMap({ cityLabel, title, hideFullMapLink }: SafeZoneMapProps) {
  return (
    <section className="surface overflow-hidden ring-1 ring-bay-200">
      <header className="flex items-baseline justify-between flex-wrap gap-2 px-4 sm:px-5 pt-4 pb-2">
        <div>
          <h3 className="font-display text-base text-slate2-900">
            {title ?? `Map overlay — ${cityLabel}`}
          </h3>
          <p className="text-xs text-slate2-500 mt-0.5">
            Neighborhood shading uses the same official police feed as the rest of this tab.
          </p>
        </div>
        {!hideFullMapLink && (
          <Link href="/map" className="text-xs text-bay-700 hover:underline">
            Open full Crime Map →
          </Link>
        )}
      </header>
      <div className="px-4 sm:px-5 pb-4">
        <CrimeMap />
      </div>
    </section>
  );
}
