"use client";
import { useState } from "react";
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

export function AreaInsightsPanel({ areaQueryString, defaultExpanded = false }: { areaQueryString: string; defaultExpanded?: boolean }) {
  const { data, loading, error } = useApi<Insights>(`/crime-data/insights?${areaQueryString}`, [areaQueryString]);
  // v67 — collapsed-by-default to match the user directive that
  // long cards should be collapsed on landing. The header still
  // shows the title + headline metric, so users can scan past
  // this card without expanding when they're not interested in
  // the 12-week trend.
  // v11 — opt-in `defaultExpanded` so the Neighborhood Awareness tab can
  // render it open on landing while the Watch page keeps it collapsed.
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <section className="surface p-4 sm:p-5">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-3 text-left hover:bg-bay-50/40 rounded-md -m-1 p-1 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden="true" className={`inline-block transition-transform text-slate2-500 text-sm shrink-0 ${expanded ? "rotate-90" : ""}`}>▶</span>
          <h2 className="font-display text-lg text-slate2-900 truncate">12-week trend{data?.area ? ` · ${data.area}` : ""}</h2>
        </div>
        {data && (
          <span className="text-xs text-slate2-500 shrink-0 tabular-nums">
            {data.totalIncidents} incidents
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-3">
          {loading && !data && <p className="text-sm text-slate2-500 animate-pulse">Crunching trend data…</p>}
          {error && !loading && (
            <p className="text-sm text-dusk-700">Couldn&apos;t load this right now. The police data may still be loading.</p>
          )}
          {data && (
            <>
              <p className="text-slate2-700">{data.brief}</p>
              <ul className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                {data.trends.map((t) => (
                  <li key={t.category} className="surface-muted p-3">
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-medium ${COLOR[t.category]}`}>{t.category.charAt(0) + t.category.slice(1).toLowerCase()}</span>
                      <DeltaPill value={t.currentVsBaseline} />
                    </div>
                    <div className={COLOR[t.category]}>
                      <Sparkline values={t.weekly} />
                    </div>
                    <div className="text-xs text-slate2-500 mt-1">
                      usual {t.baseline.toFixed(1)}/week
                    </div>
                  </li>
                ))}
                {data.trends.length === 0 && (
                  <li className="surface-muted p-3 text-xs text-slate2-500 sm:col-span-3">
                    Not enough incidents recently to draw a trend. This is typical for many neighborhoods on a quiet week.
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
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
  return <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${cls}`}>{sign}{pct}% vs usual</span>;
}
