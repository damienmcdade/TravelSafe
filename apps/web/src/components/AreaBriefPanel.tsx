"use client";
import { useState } from "react";
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
  // v95p17 — was collapsed-by-default (v67). Users reported "AI
  // summary not working" — the collapse hid the brief content
  // entirely and the disclosure-triangle affordance wasn't strong
  // enough to telegraph it was clickable. Expanded-by-default
  // surfaces the brief inline so it does the work it claims to.
  // The toggle still works for users who want to dismiss it.
  const [expanded, setExpanded] = useState(true);

  // Self-fetch path: AI is up but this area's brief is null = don't
  // render the disappearing trick that v66 fixed — surface the panel
  // with the "not enough data" fallback so users can see it tried.
  if (!body && data && !data.aiConfigured) return null;

  const briefText = body ?? data?.brief ?? null;
  const showBody = expanded;

  return (
    <section className="surface p-4 sm:p-5 bg-gradient-to-br from-white via-white to-coral-200/20">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-3 text-left hover:bg-white/40 rounded-md -m-1 p-1 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden="true" className={`inline-block transition-transform text-slate2-500 text-sm shrink-0 ${expanded ? "rotate-90" : ""}`}>▶</span>
          <h2 className="font-display text-lg text-slate2-900 truncate">AI Summary</h2>
        </div>
        <span className="text-[11px] uppercase tracking-wider text-slate2-500 shrink-0">AI · grounded in the data</span>
      </button>
      {showBody && (
        <div className="mt-3">
          {loading && (
            <div className="space-y-2">
              <div className="skel h-3 w-full" />
              <div className="skel h-3 w-11/12" />
              <div className="skel h-3 w-3/4" />
            </div>
          )}
          {error && !loading && (
            <p className="text-sm text-dusk-700">Could not generate a brief right now. The data panels below still apply.</p>
          )}
          {briefText && (
            <>
              <div className="text-sm text-slate2-900 leading-relaxed whitespace-pre-wrap">{briefText}</div>
              {data?.disclaimer && <p className="mt-3 text-[11px] text-slate2-500 italic">{data.disclaimer}</p>}
              {sourceUrl && (
                <a href={sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-bay-700 hover:underline">
                  Source →
                </a>
              )}
            </>
          )}
          {!loading && !error && !briefText && data && (
            <p className="text-sm text-slate2-500">Not enough recent data in this area to summarize.</p>
          )}
        </div>
      )}
    </section>
  );
}
