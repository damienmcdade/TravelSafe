"use client";
import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { CityBanner } from "@/components/CitySelector";
import { SafeZoneSubNav } from "@/components/SafeZoneSubNav";
import { SafeZoneAreaPicker } from "@/components/SafeZoneAreaPicker";

interface Area { slug: string; label: string; jurisdiction: string }
interface ScoreRow {
  category: "PERSONS" | "PROPERTY";
  count: number;
  localPer100k: number;
  nationalPer100k: number;
  deltaPct: number;
}
interface ScoreResp {
  city: { slug: string; label: string };
  area: { slug: string; label: string };
  populationEstimate: number;
  windowDays: number;
  asOf: string | null;
  grade: "A" | "B" | "C" | "D" | "E";
  headline: string;
  rows: ScoreRow[];
  source: { label: string; url: string; publishedYear: number };
  disclaimer: string;
}

const GRADE_TONE: Record<ScoreResp["grade"], { bg: string; ring: string; tone: string; label: string }> = {
  A: { bg: "bg-sage-100",   ring: "ring-sage-300",   tone: "text-sage-700",   label: "Well below national" },
  B: { bg: "bg-bay-50",     ring: "ring-bay-200",    tone: "text-bay-700",    label: "Below national" },
  C: { bg: "bg-sand-50",    ring: "ring-sand-300",   tone: "text-slate2-700", label: "Near national average" },
  D: { bg: "bg-amber2-100", ring: "ring-amber2-400", tone: "text-amber2-700", label: "Above national" },
  E: { bg: "bg-coral-100",  ring: "ring-coral-300",  tone: "text-coral-700",  label: "Well above national" },
};

const CAT_LABEL: Record<ScoreRow["category"], string> = {
  PERSONS:  "Violent (persons)",
  PROPERTY: "Property",
};

export default function SafetyScorePage() {
  const { city } = useCity();
  const [area, setArea] = useState<Area | null>(null);

  const path = area ? `/safezone/safety-score?area=${encodeURIComponent(area.slug)}&label=${encodeURIComponent(area.label)}` : null;
  const { data: score, loading, error } = useApi<ScoreResp>(path, [path]);
  const tone = useMemo(() => (score ? GRADE_TONE[score.grade] : null), [score]);

  return (
    <main className="space-y-6">
      <SafeZoneSubNav />
      <header className="page-hero">
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">SafeZone · Safety Score · {city.label}</p>
        <h1 className="mt-1 font-display text-3xl sm:text-4xl text-slate2-900">
          How {city.label} <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x">compares to the FBI national average</span>
        </h1>
        <p className="mt-2 text-slate2-700 max-w-2xl">
          The Safety Score annualizes your selected neighborhood&apos;s recent police-feed activity, scales it to per-100,000 residents, and lines it up against the FBI Crime in the Nation rates. Letter grade is based on the average of the two reported categories.
        </p>
      </header>
      <CityBanner />

      <SafeZoneAreaPicker
        storageKey="safety-score.area"
        onCommit={setArea}
        title={`Pick a ${city.label} neighborhood to score`}
      />

      {!area && (
        <div className="surface-muted p-6 text-sm text-slate2-500 text-center">
          Pick a neighborhood above to see how it stacks up against the FBI national average.
        </div>
      )}

      {loading && area && <ScoreSkeleton />}
      {error && !loading && (
        <p className="surface p-4 text-sm text-dusk-700">
          Could not compute the score for {area?.label}. Try a different neighborhood or come back in a moment.
        </p>
      )}

      {score && tone && (
        <>
          <section className={`surface p-5 sm:p-6 ring-1 ${tone.ring} ${tone.bg}`}>
            <div className="flex items-center gap-4">
              <div className={`flex items-center justify-center w-20 h-20 rounded-2xl ring-2 ${tone.ring} bg-white text-4xl font-display ${tone.tone}`}>
                {score.grade}
              </div>
              <div>
                <p className={`text-xs uppercase tracking-wider font-medium ${tone.tone}`}>{tone.label}</p>
                <h2 className="mt-0.5 font-display text-xl text-slate2-900">{score.area.label}, {score.city.label}</h2>
                <p className="mt-1 text-sm text-slate2-700 max-w-2xl">{score.headline}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate2-500 tabular-nums">
              <span>~{score.populationEstimate.toLocaleString()} residents (estimated, US Census Vintage 2023)</span>
              {score.windowDays > 0 && <span>·  window: ~{score.windowDays} days</span>}
              {score.asOf && <span>·  newest report: {new Date(score.asOf).toLocaleDateString()}</span>}
            </div>
          </section>

          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {score.rows.map((r) => {
              const above = r.deltaPct > 5;
              const below = r.deltaPct < -5;
              const max = Math.max(r.localPer100k, r.nationalPer100k) * 1.15 || 1;
              return (
                <li key={r.category}>
                  <article className="surface p-5 h-full">
                    <header className="flex items-baseline justify-between gap-2">
                      <h3 className="font-display text-base text-slate2-900">{CAT_LABEL[r.category]}</h3>
                      <span className={`text-xs font-medium ${above ? "text-coral-700" : below ? "text-sage-700" : "text-slate2-500"}`}>
                        {r.deltaPct > 0 ? "+" : ""}{r.deltaPct}% vs national
                      </span>
                    </header>
                    <svg viewBox="0 0 200 56" className="mt-3 w-full h-14" role="img" aria-label={`${CAT_LABEL[r.category]}: ${r.localPer100k} per 100k locally, ${r.nationalPer100k} per 100k national`}>
                      <text x="0" y="11" style={{ fontSize: 6 }} fill="#475569">{score.area.label}</text>
                      <rect x="0" y="14" width="200" height="8" rx="2" fill="#e9eef3" />
                      <rect x="0" y="14" width={(r.localPer100k / max) * 200} height="8" rx="2" fill={above ? "#E6643C" : below ? "#7BA86E" : "#3F8DBA"} />
                      <text x="200" y="11" textAnchor="end" style={{ fontSize: 6 }} fill="#475569">{r.localPer100k.toLocaleString()} / 100k</text>
                      <text x="0" y="38" style={{ fontSize: 6 }} fill="#475569">National (FBI {score.source.publishedYear})</text>
                      <rect x="0" y="41" width="200" height="8" rx="2" fill="#e9eef3" />
                      <rect x="0" y="41" width={(r.nationalPer100k / max) * 200} height="8" rx="2" fill="#94a3b8" />
                      <text x="200" y="38" textAnchor="end" style={{ fontSize: 6 }} fill="#475569">{r.nationalPer100k.toLocaleString()} / 100k</text>
                    </svg>
                    <p className="mt-3 text-xs text-slate2-500 tabular-nums">{r.count.toLocaleString()} reported in the cached window.</p>
                  </article>
                </li>
              );
            })}
          </ul>

          <p className="surface-muted p-3 text-xs text-slate2-700 leading-snug">
            {score.disclaimer} Verify the national rate at{" "}
            <a href={score.source.url} target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">
              {score.source.label}
            </a>.
          </p>
        </>
      )}
    </main>
  );
}

function ScoreSkeleton() {
  return (
    <section className="surface p-5 space-y-3">
      <div className="flex items-center gap-4">
        <div className="skel w-20 h-20 rounded-2xl" />
        <div className="flex-1 space-y-2">
          <div className="skel h-3 w-1/3" />
          <div className="skel h-5 w-1/2" />
          <div className="skel h-3 w-3/4" />
        </div>
      </div>
    </section>
  );
}
