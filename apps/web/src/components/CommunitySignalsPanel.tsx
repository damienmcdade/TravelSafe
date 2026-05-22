"use client";
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

  return (
    <section className="surface p-5">
      <header className="flex items-baseline justify-between flex-wrap gap-1">
        <h2 className="font-display text-lg text-slate2-900">Community signals</h2>
        {data?.source && <span className="text-[10px] uppercase tracking-wider text-slate2-500">{data.source}</span>}
      </header>
      <p className="mt-1 text-xs text-slate2-500">
        Recent thread titles from the city&apos;s main subreddit mentioning this area. Click through to read at the source — Reddit users may post unverified claims, treat as community-reported not official.
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
      {!loading && !error && (data?.signals.length ?? 0) === 0 && (
        <p className="mt-3 text-sm text-slate2-500">No recent threads about this area on the city&apos;s subreddit.</p>
      )}
      {!loading && (data?.signals ?? []).length > 0 && (
        <ul className="mt-3 divide-y divide-sand-200">
          {data!.signals.map((s) => (
            <li key={s.id} className="py-2.5">
              <a href={s.url} target="_blank" rel="noreferrer" className="block group">
                <span className="block text-sm text-slate2-900 group-hover:text-bay-700 transition-colors leading-snug">{s.title}</span>
                {s.excerpt && (
                  <span className="mt-1 block text-xs text-slate2-700 line-clamp-2">{s.excerpt}</span>
                )}
                <span className="mt-1 block text-[10px] text-slate2-500">
                  r/{s.subreddit} · {relativeTime(s.postedAt)} · {s.score.toLocaleString()} pts · {s.comments} comments
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
