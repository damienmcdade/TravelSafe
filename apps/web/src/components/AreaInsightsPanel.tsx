"use client";
import { useApi } from "@/lib/api-client";
import { Sparkline } from "./Sparkline";

interface Trend {
  category: "PERSONS" | "PROPERTY" | "SOCIETY";
  weekly: number[];
  baseline: number;
  currentVsBaseline: number;
}
interface Insights {
  area: string;
  windowWeeks: number;
  totalIncidents: number;
  trends: Trend[];
  brief: string;
}

const COLOR: Record<Trend["category"], string> = {
  PERSONS:  "text-slate2-700",
  PROPERTY: "text-amber2-700",
  SOCIETY:  "text-sage-700",
};

export function AreaInsightsPanel({ areaQueryString }: { areaQueryString: string }) {
  const { data, loading, error } = useApi<Insights>(`/crime-data/insights?${areaQueryString}`, [areaQueryString]);

  return (
    <section className="surface p-6">
      <header className="flex items-center justify-between">
        <h2 className="font-display text-lg text-slate2-900">{data?.area ?? "Loading area…"}</h2>
        <span className="text-xs text-slate2-500">
          {data ? `${data.windowWeeks}-week trend · ${data.totalIncidents} incidents in window` : ""}
        </span>
      </header>
      {loading && !data && <p className="mt-2 text-sm text-slate2-500 animate-pulse">Crunching trend data…</p>}
      {error && !loading && (
        <p className="mt-2 text-sm text-dusk-700">Could not load insights right now — the police data feed may be warming up.</p>
      )}
      {data && (
        <>
          <p className="mt-3 text-slate2-700">{data.brief}</p>
          <ul className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {data.trends.map((t) => (
              <li key={t.category} className="surface-muted p-3">
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-medium ${COLOR[t.category]}`}>{t.category.toLowerCase()}</span>
                  <DeltaPill value={t.currentVsBaseline} />
                </div>
                <div className={COLOR[t.category]}>
                  <Sparkline values={t.weekly} />
                </div>
                <div className="text-xs text-slate2-500 mt-1">
                  baseline {t.baseline.toFixed(1)}/wk
                </div>
              </li>
            ))}
            {data.trends.length === 0 && (
              <li className="surface-muted p-3 text-xs text-slate2-500 sm:col-span-3">
                Not enough incidents in the cached window to draw a trend. This is typical for many SD neighborhoods.
              </li>
            )}
          </ul>
        </>
      )}
    </section>
  );
}

function DeltaPill({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const cls =
    pct >= 25  ? "bg-amber2-200 text-amber2-700" :
    pct <= -25 ? "bg-sage-200 text-sage-700" :
    "bg-sand-100 text-slate2-700";
  const sign = pct > 0 ? "+" : "";
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${cls}`}>{sign}{pct}% vs baseline</span>;
}
