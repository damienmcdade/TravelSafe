"use client";
import { useApi } from "@/lib/api-client";

// v99 — honest per-city data-recency banner. Police open-data feeds
// publish on very different cadences (SF/Oakland daily, LAPD bi-weekly,
// NYPD/SDPD quarterly), and a few have genuinely frozen upstream
// (Philadelphia, Kansas City as of 2026-05-31). Without this, a user
// looking at LA saw "no crimes after May 16" and assumed the app was
// broken, when that's just LAPD's publish lag. The banner states the
// freshest available date and, when a feed appears frozen, says so
// plainly — so a lack of recent incidents never reads as an app bug.
//
// Sources the freshest-date + status from the same /safezone/trend
// endpoint the rest of the neighborhood/city view already uses (it now
// returns a `freshness` object). Renders nothing until that loads or if
// the feed has no data to judge, so it never adds a broken-looking box.

type FreshnessStatus = "fresh" | "stale" | "unknown";
interface Freshness {
  asOf: string | null;
  daysSince: number | null;
  status: FreshnessStatus;
  note: string;
}
interface TrendResp {
  freshness?: Freshness;
}

export function DataFreshnessBanner({
  areaSlug,
  areaLabel,
  citySlug,
  cityLabel,
}: {
  /// Pass an area (neighborhood drill-down) OR a city (citywide view).
  areaSlug?: string;
  areaLabel?: string;
  citySlug?: string;
  cityLabel?: string;
}) {
  const query = areaSlug
    ? `/safezone/trend?area=${encodeURIComponent(areaSlug)}&label=${encodeURIComponent(areaLabel ?? areaSlug)}`
    : citySlug
      ? `/safezone/trend?city=${encodeURIComponent(citySlug)}`
      : null;

  const { data } = useApi<TrendResp>(query, [areaSlug ?? citySlug ?? ""]);
  void cityLabel; // reserved for future copy; trend response carries labels

  const fresh = data?.freshness;
  if (!fresh || fresh.status === "unknown" || !fresh.note) return null;

  if (fresh.status === "stale") {
    return (
      <aside
        role="status"
        className="surface-muted px-4 py-3 text-xs sm:text-sm text-amber2-700 border border-amber2-300/50 rounded-xl flex items-start gap-2"
      >
        <span aria-hidden="true" className="shrink-0 mt-0.5">⚠</span>
        <span>
          <strong className="text-slate2-900">Upstream feed looks stale.</strong> {fresh.note}
        </span>
      </aside>
    );
  }

  // Fresh — subtle, reassuring one-liner.
  return (
    <p className="px-1 text-[11px] sm:text-xs text-slate2-500" role="status">
      {fresh.note}
    </p>
  );
}
