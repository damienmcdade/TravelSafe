"use client";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { DataProvenanceBanner, CommunityReportedLabel, type ProvenanceLike } from "@/components/DataProvenanceBanner";
import { LocationSearch } from "@/components/LocationSearch";
import { AreaInsightsPanel } from "@/components/AreaInsightsPanel";
import { OfficialAlertsPanel } from "@/components/OfficialAlertsPanel";
import { LiveActivityBadge } from "@/components/LiveActivityBadge";
import { CategoryBreakdown } from "@/components/CategoryBreakdown";
import { RecentIncidentsCards } from "@/components/RecentIncidentsCards";
import { NewsPanel } from "@/components/NewsPanel";
import { CrimeMixCard } from "@/components/CrimeMixCard";
import { CityBanner } from "@/components/CitySelector";
import { relativeTime } from "@/lib/sse";

interface Area { slug: string; label: string; jurisdiction: string; id?: string; name?: string }
interface Feed {
  area: Area;
  posts: { id: string; body: string; createdAt: string; reviewedAt: string | null; _count: { comments: number; reactions: number } }[];
  alerts: { area: string; category: string; riskLevel: 1|2|3|4|5; summary: string; recency: string; provenance: ProvenanceLike }[];
  recent: { id: string; ibrOffenseDescription: string; occurredAt: string; nibrsCategory: "PERSONS"|"PROPERTY"|"SOCIETY"; beat?: string | null; area: string }[];
}
interface PerArea { slug: string; byCategory: { PERSONS: number; PROPERTY: number; SOCIETY: number } }
interface Citywide { perArea: PerArea[] }

export default function NeighborhoodPage() {
  const { city } = useCity();
  const [area, setArea] = useState<Area | null>(null);
  useEffect(() => { setArea(null); }, [city.slug]);
  const slug = area?.slug ?? city.defaultArea;
  const { data: feed } = useApi<Feed>(`/neighborhood/feed?neighborhood=${slug}`, [slug]);
  const { data: citywide } = useApi<Citywide>(`/crime-data/citywide?city=${city.slug}`, [city.slug]);
  const counts = citywide?.perArea.find((p) => p.slug === slug)?.byCategory ?? { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 };

  return (
    <main className="space-y-8">
      <header className="page-hero flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-sage-700 font-medium">Neighborhood Watch · {city.label}</p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl text-slate2-900">
            One neighborhood, the full picture
          </h1>
          <p className="mt-2 text-slate2-700 max-w-2xl">
            Zoom into a single {city.label} neighborhood. Real police incidents, what neighbors are saying, and the headlines — in one focused view.
          </p>
        </div>
        <LiveActivityBadge />
      </header>

      <CityBanner />

      <LocationSearch current={area} onResolved={setArea} placeholder={`Search a ${city.label} neighborhood, ZIP, or landmark`} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-6">
          <AreaInsightsPanel areaQueryString={`neighborhood=${slug}`} />
          <CategoryBreakdown counts={counts} title={`${feed?.area.name ?? slug} — incident mix`} subtitle="Recent cached window." />
          <CrimeMixCard areaSlug={slug} title={`${feed?.area.name ?? slug} — specific offenses, last 30 days`} />
          <RecentIncidentsCards area={slug} title={`Recently reported in ${feed?.area.name ?? slug}`} />
          <section className="space-y-3">
            <h2 className="font-display text-xl text-slate2-900">Verified neighbor reports</h2>
            {(feed?.posts ?? []).length === 0 && (
              <p className="surface-muted p-4 text-sm text-slate2-500">No verified neighbor posts here yet. Quiet streets tend to stay quiet on the feed too.</p>
            )}
            {(feed?.posts ?? []).map((p) => (
              <article key={p.id} className="surface p-5 animate-rise-in">
                <div className="flex justify-between items-center text-xs">
                  <CommunityReportedLabel reviewedAt={p.reviewedAt} />
                  <span className="text-slate2-500">{relativeTime(p.createdAt)}</span>
                </div>
                <pre className="mt-2 whitespace-pre-wrap text-slate2-900 font-sans text-sm">{p.body}</pre>
              </article>
            ))}
          </section>
          <DataProvenanceBanner provenance={feed?.alerts[0]?.provenance} />
        </div>
        <aside className="space-y-4">
          <NewsPanel areaSlug={slug} />
          <OfficialAlertsPanel />
        </aside>
      </div>
    </main>
  );
}
