"use client";
import { useApi } from "@/lib/api-client";

interface Tip {
  id: string;
  title: string;
  body: string;
  source: string;
  sourceUrl: string;
  relevance: number;
}
interface Resp {
  area: string;
  basedOn: { dominantCategory: string | null; topOffense?: string };
  tips: Tip[];
  disclaimer: string;
}

export function SafetyTipsPanel({ areaSlug, jurisdictionSlug }: { areaSlug?: string; jurisdictionSlug?: string }) {
  const path = areaSlug ? `/safety/tips?neighborhood=${areaSlug}` : jurisdictionSlug ? `/safety/tips?jurisdiction=${jurisdictionSlug}` : "/safety/tips?jurisdiction=san-diego";
  const { data, loading, error } = useApi<Resp>(path, [path]);

  return (
    <section className="surface p-6 bg-gradient-to-br from-bay-50 via-white to-coral-200/30">
      <header className="flex items-baseline justify-between">
        <h2 className="font-display text-xl text-slate2-900">Practical tips for this area</h2>
        {data?.basedOn.topOffense && <span className="text-xs text-slate2-500">Based on: {data.basedOn.topOffense}</span>}
      </header>
      <p className="mt-1 text-xs text-slate2-500">
        Best-practice safety guidance from official sources, picked to match what&apos;s actually being reported in the area.
      </p>
      {loading && (
        <ul className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="surface p-4 space-y-2"><div className="skel h-4 w-2/3" /><div className="skel h-3 w-full" /><div className="skel h-3 w-5/6" /></li>
          ))}
        </ul>
      )}
      {error && !loading && <p className="mt-3 text-sm text-dusk-700">Couldn&apos;t load tips right now.</p>}
      {!loading && (data?.tips ?? []).length > 0 && (
        <ul className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {data!.tips.map((t) => (
            <li key={t.id}>
              <article className="surface p-4 h-full bg-gradient-to-br from-white to-sand-50 hover:shadow-glow-bay transition-all animate-rise-in">
                <h3 className="font-display text-base text-slate2-900">{t.title}</h3>
                <p className="mt-1.5 text-sm text-slate2-700 leading-snug">{t.body}</p>
                <a href={t.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-bay-700 hover:underline">
                  Source: {t.source} →
                </a>
              </article>
            </li>
          ))}
        </ul>
      )}
      {data?.disclaimer && (
        <p className="mt-4 text-xs text-slate2-500">{data.disclaimer}</p>
      )}
    </section>
  );
}
