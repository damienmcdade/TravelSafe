"use client";
import { useApi } from "@/lib/api-client";

interface Resp { area: string; brief: string | null; aiConfigured: boolean; disclaimer: string }

/// Canonical "AI brief in plain English" card. Two callsites:
///   1. /now (Neighborhood section) — passes only `areaSlug`; the
///      component fetches /ai/area-brief itself.
///   2. /watch — has the brief body already in the watch payload (the
///      backend pre-renders the "ai" group card), so it passes the
///      `body` prop directly to avoid a duplicate fetch.
///
/// Same visual treatment in both places — the redundancy audit
/// flagged two diverging styles for the same conceptual surface;
/// this component is the single source of truth.
export function AreaBriefPanel({
  areaSlug,
  body,
  sourceUrl,
}: {
  /// Required when `body` is not provided — drives the self-fetch.
  areaSlug?: string;
  /// Pre-rendered brief body. When supplied, no fetch happens —
  /// caller is responsible for the brief content.
  body?: string;
  /// Optional source link (used by /watch which surfaces a citation
  /// link under every card). When omitted no link renders.
  sourceUrl?: string;
}) {
  const shouldFetch = body == null && !!areaSlug;
  const { data, loading, error } = useApi<Resp>(
    shouldFetch ? `/ai/area-brief?area=${encodeURIComponent(areaSlug!)}` : null,
    [areaSlug ?? ""],
  );

  // Pre-rendered body path: render immediately, skip loading/error states.
  if (body) {
    return (
      <section className="surface p-5 bg-gradient-to-br from-white via-white to-coral-200/20">
        <header className="flex items-baseline justify-between flex-wrap gap-1">
          <h2 className="font-display text-lg text-slate2-900">AI Summary</h2>
          <span className="text-[10px] uppercase tracking-wider text-slate2-500">AI · grounded in the data</span>
        </header>
        <div className="mt-3 text-sm text-slate2-900 leading-relaxed whitespace-pre-wrap">{body}</div>
        {sourceUrl && (
          <a href={sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-bay-700 hover:underline">
            Source →
          </a>
        )}
      </section>
    );
  }

  // Self-fetch path (the original AreaBriefPanel behavior).
  if (data && !data.aiConfigured) return null;
  return (
    <section className="surface p-5 bg-gradient-to-br from-white via-white to-coral-200/20">
      <header className="flex items-baseline justify-between flex-wrap gap-1">
        <h2 className="font-display text-lg text-slate2-900">AI Summary</h2>
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
          <div className="mt-3 text-sm text-slate2-900 leading-relaxed whitespace-pre-wrap">{data.brief}</div>
          <p className="mt-3 text-[10px] text-slate2-500 italic">{data.disclaimer}</p>
        </>
      )}
      {!loading && !error && data && !data.brief && (
        <p className="mt-3 text-sm text-slate2-500">Not enough recent data in this area to summarize.</p>
      )}
    </section>
  );
}
