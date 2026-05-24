"use client";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { useArea } from "@/lib/use-area";
import { useDocumentTitle } from "@/lib/use-document-title";
import { DataProvenanceBanner, type ProvenanceLike } from "@/components/DataProvenanceBanner";
import { LiveActivityBadge } from "@/components/LiveActivityBadge";
import { CrimeChart } from "@/components/CrimeChart";
import { IncidentSummaryCard } from "@/components/IncidentSummaryCard";
import { HotspotCard } from "@/components/HotspotCard";
import { NewsPanel } from "@/components/NewsPanel";
import { OfficialAlertsPanel } from "@/components/OfficialAlertsPanel";
import { UptickTile } from "@/components/UptickTile";
import {
  BlockScoreWidget,
  ThreatFeed,
  useSafeZoneData,
} from "@/components/SafeZoneTab";
import SafetyScorePage from "../safety-score/page";

interface PerArea { slug: string; label: string; incidentCount: number; riskLevel: 1|2|3|4|5; byCategory: { PERSONS: number; PROPERTY: number; SOCIETY: number }; dominantCategory: "PERSONS"|"PROPERTY"|"SOCIETY"|null }
interface Alert { area: string; category: "PERSONS"|"PROPERTY"|"SOCIETY"; riskLevel: 1|2|3|4|5; summary: string; recency: string; provenance: ProvenanceLike }
interface Citywide { city: string; totalIncidents: number; alerts: Alert[]; perArea: PerArea[] }

/// City Awareness — every information card that pertains to the
/// user-selected city only. Citywide signals; no per-neighborhood
/// drill-down. Clicking a hotspot in the leaderboard jumps over to
/// Neighborhood Awareness with that area pre-selected.
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
    // Setting the global area and routing — Neighborhood Awareness
    // reads from the same global store so the user lands there with
    // the right area already focused.
    setArea({ slug, label, jurisdiction: city.label });
    window.location.href = "/neighborhood";
  }

  return (
    <main className="space-y-4">
      <header className="page-hero flex flex-wrap items-center gap-3 justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">City Awareness</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl text-slate2-900">
            What&apos;s happening in <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x">{city.label}</span>
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

      <CitywideSafeZoneSection city={{ slug: city.slug, label: city.label }} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <IncidentSummaryCard
          citySlug={city.slug}
          contextLabel={`${city.label} (citywide)`}
        />
        <HotspotCard
          citySlug={city.slug}
          cityLabel={city.label}
          onPickArea={selectNeighborhood}
        />
      </div>

      <CrimeChart mode="city" citySlug={city.slug} cityLabel={city.label} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <NewsPanel />
        <OfficialAlertsPanel />
      </div>

      <UptickTile />
      <DataProvenanceBanner provenance={citywide?.alerts[0]?.provenance ?? null} />

      {/* Migrated Safety Score section — renders the full SafetyScorePage
          body inline (grade card, per-category bars, compare overlay,
          methodology note, inline TrendPanel). The Safety Score sub-tab
          on /plan is gone; this is the canonical Safety Score surface
          now and it lives on City Awareness so users see the FBI
          national-comparison grade alongside the citywide signals. */}
      <div className="border-t border-sand-200 pt-4" aria-hidden />
      <SafetyScorePage />
    </main>
  );
}

function CitywideSafeZoneSection({ city }: { city: { slug: string; label: string } }) {
  const data = useSafeZoneData({
    city: { slug: city.slug, label: city.label },
    area: null,
  });
  const sourceLabel = `${city.label} official police open-data feed`;
  return (
    <div className="space-y-3">
      <BlockScoreWidget
        score={data.blockScore}
        loading={data.loading}
        unavailable={!data.loading && !data.blockScore}
        contextLabel={`${city.label} (citywide)`}
      />
      <ThreatFeed
        threats={data.threats}
        baseline={data.baseline}
        windowDays={data.windowDays}
        contextLabel={`${city.label} citywide`}
        source={{ label: sourceLabel, url: "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend" }}
        loading={data.loading}
      />
    </div>
  );
}
