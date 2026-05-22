"use client";
import { useApi } from "@/lib/api-client";

interface Resp { area: string; brief: string | null; aiConfigured: boolean; disclaimer: string }

/// Per-neighborhood AI brief — two short paragraphs of plain prose grounded
/// in the area's actual top reported offenses. Sits alongside the
/// AreaInsightsPanel as the "what does this mean in plain English" layer.
export function AreaBriefPanel({ areaSlug }: { areaSlug: string }) {
  const { data, loading, error } = useApi<Resp>(
    `/ai/area-brief?area=${encodeURIComponent(areaSlug)}`,
    [areaSlug],
  );

  if (data && !data.aiConfigured) return null;

  return (
    <section className="surface p-5 bg-gradient-to-br from-white via-white to-coral-200/20">
      <header className="flex items-baseline justify-between flex-wrap gap-1">
        <h2 className="font-display text-lg text-slate2-900">In plain English</h2>
        <span className="text-[10px] uppercase tracking-wider text-slate2-500">AI · grounded in the data</span>
      </header>

      {loading && (
        <div className="mt-3 space-y-2">
          <div className="skel h-3 w-full" />
          <div className="skel h-3 w-11/12" />
          <div className="skel h-3 w-3/4" />
        </div>
      )}
      {error && !loading && (
        <p className="mt-3 text-sm text-dusk-700">Could not generate a brief right now. The data panels below still apply.</p>
      )}
      {!loading && !error && data?.brief && (
        <>
          <div className="mt-3 text-sm text-slate2-900 leading-relaxed whitespace-pre-wrap">
            {data.brief}
          </div>
          <p className="mt-3 text-[10px] text-slate2-500 italic">{data.disclaimer}</p>
        </>
      )}
      {!loading && !error && data && !data.brief && (
        <p className="mt-3 text-sm text-slate2-500">Not enough recent data in this area to summarize.</p>
      )}
    </section>
  );
}
