"use client";
import { useState } from "react";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { CityBanner } from "@/components/CitySelector";
import { SafeZoneSubNav } from "@/components/SafeZoneSubNav";
import { SafeZoneAreaPicker } from "@/components/SafeZoneAreaPicker";

interface Area { slug: string; label: string; jurisdiction: string }
interface TrendBullet {
  kind: "trend" | "dispatch";
  at: string;
  text: string;
  category?: "PERSONS" | "PROPERTY" | "SOCIETY";
}
interface TrendResp {
  city: { slug: string; label: string };
  area: { slug: string; label: string };
  windowStart: string;
  totalIncidents: number;
  bullets: TrendBullet[];
  source: { label: string; url: string };
  disclaimer: string;
}

// Match the muted gradient the rest of the app uses — terracotta, sand-gold,
// slate-teal. Tailwind utilities don't have these exact tones so we use
// inline style colors via plain hex.
const CAT_DOT: Record<NonNullable<TrendBullet["category"]>, string> = {
  PERSONS:  "bg-[#C47C62]",
  PROPERTY: "bg-[#CBA56C]",
  SOCIETY:  "bg-[#5C8AA7]",
};

export default function TrendFeedPage() {
  const { city } = useCity();
  const [area, setArea] = useState<Area | null>(null);

  const path = area ? `/safezone/trend?area=${encodeURIComponent(area.slug)}&label=${encodeURIComponent(area.label)}` : null;
  const { data: trend, loading, error } = useApi<TrendResp>(path, [path]);

  const trendBullets = trend?.bullets.filter((b) => b.kind === "trend") ?? [];
  const dispatchBullets = trend?.bullets.filter((b) => b.kind === "dispatch") ?? [];

  return (
    <main className="space-y-6">
      <SafeZoneSubNav />
      <header className="page-hero">
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">SafeZone · Trend Feed · {city.label}</p>
        <h1 className="mt-1 font-display text-3xl sm:text-4xl text-slate2-900">
          What&apos;s shifted in <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x">{city.label} over the past 30 days</span>
        </h1>
        <p className="mt-2 text-slate2-700 max-w-2xl">
          A bulleted, chronological summary of recent local police dispatches plus a week-over-week shift line per NIBRS group. Pulled straight from the same official feed that powers the Crime Map.
        </p>
      </header>
      <CityBanner />

      <SafeZoneAreaPicker
        storageKey="trend-feed.area"
        onCommit={setArea}
        title={`Pick a ${city.label} neighborhood for trends`}
      />

      {!area && (
        <div className="surface-muted p-6 text-sm text-slate2-500 text-center">
          Pick a neighborhood above to see its 30-day police-feed timeline.
        </div>
      )}

      {loading && area && <TrendSkeleton />}
      {error && !loading && (
        <p className="surface p-4 text-sm text-dusk-700">
          Could not load the trend feed for {area?.label}. Try again in a moment.
        </p>
      )}

      {trend && !loading && (
        <>
          {trendBullets.length > 0 && (
            <section className="surface p-5 bg-gradient-to-br from-white to-bay-50">
              <header className="flex items-baseline justify-between flex-wrap gap-2">
                <h2 className="font-display text-lg text-slate2-900">Week-over-week shift</h2>
                <span className="text-xs text-slate2-500">{trend.area.label}</span>
              </header>
              <ul className="mt-3 space-y-2">
                {trendBullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate2-700">
                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${b.category ? CAT_DOT[b.category] : "bg-slate2-400"}`} />
                    <span>{b.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="surface p-5">
            <header className="flex items-baseline justify-between flex-wrap gap-2">
              <h2 className="font-display text-lg text-slate2-900">Recent dispatches in {trend.area.label}</h2>
              <span className="text-xs text-slate2-500">{trend.totalIncidents.toLocaleString()} in last 30 days</span>
            </header>

            {dispatchBullets.length === 0 ? (
              <p className="mt-3 text-sm text-slate2-500">
                No dispatches in the past 30 days for this neighborhood — that&apos;s normal for many areas in any given month.
              </p>
            ) : (
              <ol className="mt-3 space-y-1.5">
                {dispatchBullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate2-700">
                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${b.category ? CAT_DOT[b.category] : "bg-slate2-400"}`} />
                    <span>{b.text}</span>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-4 text-xs text-slate2-500">
              Source:{" "}
              <a href={trend.source.url} target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">
                {trend.source.label}
              </a>
            </p>
          </section>

          <p className="surface-muted p-3 text-xs text-slate2-700 leading-snug">
            {trend.disclaimer}
          </p>
        </>
      )}
    </main>
  );
}

function TrendSkeleton() {
  return (
    <>
      <section className="surface p-5 space-y-2">
        <div className="skel h-4 w-1/3" />
        <div className="skel h-3 w-2/3" />
        <div className="skel h-3 w-1/2" />
      </section>
      <section className="surface p-5 space-y-2">
        <div className="skel h-4 w-1/2" />
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skel h-3 w-full" />)}
      </section>
    </>
  );
}
