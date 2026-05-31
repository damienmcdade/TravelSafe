"use client";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { useArea } from "@/lib/use-area";
import { useDocumentTitle } from "@/lib/use-document-title";
import { DataProvenanceBanner, type ProvenanceLike } from "@/components/DataProvenanceBanner";
import { LiveActivityBadge } from "@/components/LiveActivityBadge";
import { IncidentSummaryCard } from "@/components/IncidentSummaryCard";
import { DataFreshnessBanner } from "@/components/DataFreshnessBanner";
import { HotspotCard } from "@/components/HotspotCard";
import { NewsPanel } from "@/components/NewsPanel";
import { OfficialAlertsPanel } from "@/components/OfficialAlertsPanel";
import { AmberAlertsBanner } from "@/components/AmberAlertsBanner";
import { TrafficAlertsPanel } from "@/components/TrafficAlertsPanel";
import { UptickTile } from "@/components/UptickTile";
import {
  BlockScoreWidget,
  ThreatFeed,
  useSafeZoneData,
} from "@/components/SafeZoneTab";
import { CityScoreCard } from "@/components/CityScoreCard";

interface PerArea { slug: string; label: string; incidentCount: number; riskLevel: 1|2|3|4|5; byCategory: { PERSONS: number; PROPERTY: number; SOCIETY: number }; dominantCategory: "PERSONS"|"PROPERTY"|"SOCIETY"|null }
interface Alert { area: string; category: "PERSONS"|"PROPERTY"|"SOCIETY"; riskLevel: 1|2|3|4|5; summary: string; recency: string; provenance: ProvenanceLike }
interface Citywide { city: string; totalIncidents: number; alerts: Alert[]; perArea: PerArea[] }

/// City Awareness — every information card that pertains to the
/// user-selected city only. Citywide signals; no per-neighborhood
/// drill-down. Clicking a hotspot in the leaderboard jumps over to
/// Neighborhood Awareness with that area pre-selected.
///
/// Card order per the v9 directive:
///   1. Safety Index            (BlockScore)
///   2. City Letter Score       (CityScoreCard — grade + violent/property bars)
///   3. Recent Upticks          (UptickTile)
///   4. Local Activity          (ThreatFeed, with in-card window picker)
///   5. AI Summary              (IncidentSummaryCard)
///   6. Hotspots                (HotspotCard)
///   7. Weather + News          (OfficialAlertsPanel + NewsPanel)
///   8. ALL disclaimer banners  (DataProvenanceBanner, last)
///
/// CrimeChart removed from City Awareness — its area-breakdown function
/// is duplicated by CityScoreCard's per-category bars + HotspotCard's
/// per-neighborhood activity counts.
export default function CityAwarenessPage() {
  const { city } = useCity();
  const { setArea } = useArea(city.slug);
  useDocumentTitle(`City Awareness · ${city.label}`);

  const REFRESH_MS = 15 * 60 * 1000;
  const { data: citywide, error: citywideErr, loading: citywideLoading } = useApi<Citywide>(
    `/crime-data/citywide?city=${city.slug}`,
    [city.slug],
    { refreshIntervalMs: REFRESH_MS },
  );

  function selectNeighborhood(slug: string, label: string) {
    setArea({ slug, label, jurisdiction: city.label });
    window.location.href = "/neighborhood";
  }

  return (
    <main className="space-y-4">
      {/* v95p19 — AMBER alerts banner renders inline at top when
          active for the user's state; renders nothing otherwise.
          Time-critical missing-child surface, distinct from the
          rolled-up weather/quake feed below. */}
      <AmberAlertsBanner />
      <header className="page-hero flex flex-wrap items-center gap-3 justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">City Awareness</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl leading-tight text-slate2-900">
            What&apos;s happening in <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x break-words">{city.label}</span>
          </h1>
          <p className="mt-2 text-slate2-700 max-w-2xl">
            Citywide signals only. Drill into a neighborhood from the hotspots panel below, or open Neighborhood Awareness.
          </p>
        </div>
        <LiveActivityBadge />
      </header>

      {citywideErr && !citywideLoading && (
        <div role="alert" className="surface p-4 text-sm text-dusk-700">
          Couldn&apos;t reach the {city.label} citywide police feed just now. Cards below may show
          stale cached data — try again in ~10 seconds. ({citywideErr.message})
        </div>
      )}

      {/* v99 — honest data-recency line: states the freshest available
          date and flags genuinely frozen upstream feeds, so "no recent
          crimes" never reads as an app bug. */}
      <DataFreshnessBanner citySlug={city.slug} cityLabel={city.label} />

      {/* 1. Safety Index + 2. City Letter Score — stacked top of page. */}
      <SafetyIndex city={{ slug: city.slug, label: city.label }} />
      <CityScoreCard citySlug={city.slug} cityLabel={city.label} />

      {/* 3. Recent Upticks above Local Activity. */}
      <UptickTile />

      {/* 4. Local Activity (ThreatFeed) — scrollable, has its own
             in-card window picker driven by the shared useTimeWindow
             store. */}
      <LocalActivity city={{ slug: city.slug, label: city.label }} />

      {/* 5. AI Summary card (renamed IncidentSummaryCard heading). */}
      <IncidentSummaryCard
        citySlug={city.slug}
        contextLabel={`${city.label} (citywide)`}
      />

      {/* 6. Hotspots — click a row to focus that neighborhood. */}
      <HotspotCard
        citySlug={city.slug}
        cityLabel={city.label}
        onPickArea={selectNeighborhood}
      />

      {/* 7. Weather + News — paired two-column row. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <OfficialAlertsPanel />
        <NewsPanel />
      </div>

      {/* 7b. Road conditions (CHP) — California cities only; renders
             nothing when there are no active nearby collisions/closures,
             so it adds no footprint elsewhere or on quiet days. */}
      <TrafficAlertsPanel />

      {/* 8. ALL informational source banner disclaimers anchored to the
             bottom of the page per v9 directive. DataProvenanceBanner
             is the per-source citation; the global DataDisclaimer
             (mounted at the (app) shell footer) follows below this
             page automatically. */}
      <DataProvenanceBanner provenance={citywide?.alerts[0]?.provenance ?? null} />
    </main>
  );
}

/// Just the BlockScore — split out of the prior CitywideSafeZoneSection
/// because the v9 layout interleaves CityScoreCard between Safety
/// Index and Local Activity.
function SafetyIndex({ city }: { city: { slug: string; label: string } }) {
  const data = useSafeZoneData({
    city: { slug: city.slug, label: city.label },
    area: null,
  });
  return (
    <BlockScoreWidget
      score={data.blockScore}
      loading={data.loading}
      unavailable={!data.loading && !data.blockScore}
      contextLabel={`${city.label} (citywide)`}
    />
  );
}

/// Just the ThreatFeed — same data hook as SafetyIndex; the SWR cache
/// shares the underlying fetch so this isn't a duplicate request.
function LocalActivity({ city }: { city: { slug: string; label: string } }) {
  const data = useSafeZoneData({
    city: { slug: city.slug, label: city.label },
    area: null,
  });
  // Source surfaces the actual adapter's dataset URL (e.g.,
  // data.sandiego.gov, data.dc.gov) — previously hardcoded to the
  // FBI CDE national-stats explorer, which never reflected the
  // city's real data source. Falls back to the FBI CDE only if the
  // adapter omits provenance (shouldn't happen for any live city).
  const source = data.source ?? {
    label: `${city.label} official police open-data feed`,
    url: "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend",
  };
  return (
    <ThreatFeed
      threats={data.threats}
      baseline={data.baseline}
      windowDays={data.windowDays}
      contextLabel={`${city.label} citywide`}
      source={source}
      loading={data.loading}
    />
  );
}
