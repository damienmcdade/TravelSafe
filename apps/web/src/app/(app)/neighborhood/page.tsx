"use client";
import { useState } from "react";
import { useApi } from "@/lib/api-client";
import { DataProvenanceBanner, CommunityReportedLabel, type ProvenanceLike } from "@/components/DataProvenanceBanner";
import { RiskBadge } from "@/components/RiskBadge";
import { LocationSearch } from "@/components/LocationSearch";
import { AreaInsightsPanel } from "@/components/AreaInsightsPanel";
import { OfficialAlertsPanel } from "@/components/OfficialAlertsPanel";
import { LiveActivityBadge } from "@/components/LiveActivityBadge";
import { relativeTime } from "@/lib/sse";

interface Area { slug: string; label: string; jurisdiction: string; id?: string; name?: string }
interface Feed {
  area: Area;
  posts: { id: string; body: string; createdAt: string; reviewedAt: string | null; _count: { comments: number; reactions: number } }[];
  alerts: { area: string; category: string; riskLevel: 1 | 2 | 3 | 4 | 5; summary: string; recency: string; provenance: ProvenanceLike }[];
  recent: { id: string; ibrOffenseDescription: string; occurredAt: string; beat?: string | null }[];
}

export default function NeighborhoodPage() {
  const [area, setArea] = useState<Area | null>(null);
  const slug = area?.slug ?? "pacific-beach";
  const { data: feed } = useApi<Feed>(`/neighborhood/feed?neighborhood=${slug}`, [slug]);

  return (
    <main className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-slate2-900">Neighborhood Watch</h1>
          <p className="mt-1 text-slate2-500 max-w-2xl">
            A focused view of one San Diego neighborhood. Search any neighborhood, ZIP, or landmark.
          </p>
        </div>
        <LiveActivityBadge />
      </header>

      <LocationSearch current={area} onResolved={setArea} placeholder="Search a specific neighborhood, ZIP, or landmark" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-6">
          <AreaInsightsPanel areaQueryString={`neighborhood=${slug}`} />

          {feed?.alerts && feed.alerts.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-lg text-slate2-900">Area alerts</h2>
              {feed.alerts.map((a, i) => (
                <article key={i} className="surface p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate2-900">{a.category.toLowerCase()} incidents</span>
                    <RiskBadge level={a.riskLevel} />
                  </div>
                  <p className="mt-2 text-slate2-700">{a.summary}</p>
                  <p className="text-xs text-slate2-500 mt-2">Recency: {a.recency}</p>
                </article>
              ))}
              <DataProvenanceBanner provenance={feed.alerts[0]?.provenance} />
            </section>
          )}

          <section className="space-y-3">
            <h2 className="font-display text-lg text-slate2-900">Recent public-record incidents</h2>
            {(feed?.recent ?? []).length === 0 && <p className="text-sm text-slate2-500">No recent incidents in the cached window.</p>}
            <ul className="space-y-2">
              {(feed?.recent ?? []).map((r) => (
                <li key={r.id} className="surface-muted p-3 text-sm flex justify-between">
                  <span>{r.ibrOffenseDescription}</span>
                  <span className="text-slate2-500">{new Date(r.occurredAt).toLocaleDateString()} {r.beat ? `· beat ${r.beat}` : ""}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate2-500">Source: SDPD NIBRS — quarterly, neighborhood/beat aggregated. Not live, not street-level.</p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-lg text-slate2-900">Verified community posts</h2>
            {(feed?.posts ?? []).map((p) => (
              <article key={p.id} className="surface p-5">
                <div className="flex justify-between items-center">
                  <CommunityReportedLabel reviewedAt={p.reviewedAt} />
                  <span className="text-xs text-slate2-500">{relativeTime(p.createdAt)}</span>
                </div>
                <pre className="mt-2 whitespace-pre-wrap text-slate2-900 font-sans text-sm">{p.body}</pre>
              </article>
            ))}
          </section>
        </div>

        <aside className="space-y-4">
          <OfficialAlertsPanel />
        </aside>
      </div>
    </main>
  );
}
