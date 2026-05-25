"use client";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/api-client";
import { relativeTime } from "@/lib/sse";

interface Signal {
  id: string;
  title: string;
  excerpt: string;
  url: string;
  subreddit: string;
  postedAt: string;
  score: number;
  comments: number;
}
interface Resp { area: string; source: string; signals: Signal[]; disclaimer: string }

/// Per-neighborhood community signals — recent thread titles from the city's
/// main subreddit filtered to the selected neighborhood. Click-through to the
/// original thread on Reddit; we never re-host comments here.
export function CommunitySignalsPanel({ areaSlug }: { areaSlug: string }) {
  const { data, loading, error } = useApi<Resp>(
    `/community/signals?area=${encodeURIComponent(areaSlug)}`,
    [areaSlug],
  );
  // v70 — collapsed-by-default panel; mirrors AreaBriefPanel /
  // AreaInsightsPanel / NewsPanel. Reset on area change so each new
  // neighborhood starts closed.
  const [panelOpen, setPanelOpen] = useState(false);
  useEffect(() => { setPanelOpen(false); }, [areaSlug]);

  const sigCount = data?.signals?.length ?? 0;

  return (
    <section className="surface p-4 sm:p-5">
      <button
        type="button"
        onClick={() => setPanelOpen(!panelOpen)}
        aria-expanded={panelOpen}
        className="w-full flex items-center justify-between gap-3 text-left hover:bg-bay-50/40 rounded-md -m-1 p-1 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden="true" className={`inline-block transition-transform text-slate2-500 text-sm shrink-0 ${panelOpen ? "rotate-90" : ""}`}>▶</span>
          <h2 className="font-display text-lg text-slate2-900 truncate">Community signals</h2>
        </div>
        {data?.source && <span className="text-[11px] uppercase tracking-wider text-slate2-500 shrink-0">{data.source}{sigCount > 0 ? ` · ${sigCount}` : ""}</span>}
      </button>
      {panelOpen && (
        <div className="mt-3">
          <p className="text-xs text-slate2-500">
            Recent thread titles from the city&apos;s main subreddit mentioning this area. Click through to read at the source — Reddit users may post unverified claims, treat as community-reported, not official.
          </p>
          {loading && (
            <ul className="mt-3 space-y-3">
              {[0, 1, 2].map((i) => (
                <li key={i} className="space-y-1.5"><div className="skel h-3 w-3/4" /><div className="skel h-2 w-1/2" /></li>
              ))}
            </ul>
          )}
          {error && !loading && (
            <p className="mt-3 text-sm text-dusk-700">Could not reach Reddit right now.</p>
          )}
          {!loading && !error && sigCount === 0 && (
            <p className="mt-3 text-sm text-slate2-500">No recent threads about this area on the city&apos;s subreddit.</p>
          )}
          {!loading && sigCount > 0 && (
            <ul className="mt-3 divide-y divide-sand-200">
              {data!.signals.map((s) => (
                <li key={s.id} className="py-2.5">
                  <a href={s.url} target="_blank" rel="noreferrer" className="block group">
                    <span className="block text-sm text-slate2-900 group-hover:text-bay-700 transition-colors leading-snug">{s.title}</span>
                    {s.excerpt && (
                      <span className="mt-1 block text-xs text-slate2-700 line-clamp-2">{s.excerpt}</span>
                    )}
                    <span className="mt-1 block text-[11px] text-slate2-500">
                      r/{s.subreddit} · {relativeTime(s.postedAt)} · {s.score.toLocaleString()} pts · {s.comments} comments
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
