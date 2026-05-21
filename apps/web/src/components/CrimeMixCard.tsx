"use client";
import { useApi } from "@/lib/api-client";
import { relativeTime } from "@/lib/sse";

interface Slice { offense: string; category: "PERSONS" | "PROPERTY" | "SOCIETY"; count: number; lastOccurredAt: string }
interface Mix { area: string; windowDays: number; totalIncidents: number; topOffenses: Slice[] }

const COLOR: Record<Slice["category"], { bar: string; chip: string; iconBg: string }> = {
  PERSONS:  { bar: "linear-gradient(90deg, #3FA6CC, #1E78A6)",  chip: "bg-bay-200 text-bay-700",     iconBg: "bg-bay-100" },
  PROPERTY: { bar: "linear-gradient(90deg, #EE8A66, #E6643C)",  chip: "bg-coral-200 text-coral-700", iconBg: "bg-coral-200" },
  SOCIETY:  { bar: "linear-gradient(90deg, #C2E0BD, #5B9E51)",  chip: "bg-sage-200 text-sage-700",   iconBg: "bg-sage-200" },
};

export function CrimeMixCard({ areaSlug, jurisdictionSlug, title }: { areaSlug?: string; jurisdictionSlug?: string; title?: string }) {
  const path = areaSlug ? `/crime-data/mix?neighborhood=${areaSlug}` : jurisdictionSlug ? `/crime-data/mix?jurisdiction=${jurisdictionSlug}` : null;
  const { data, loading, error } = useApi<Mix>(path, [path]);
  const max = Math.max(1, ...(data?.topOffenses ?? []).map((o) => o.count));

  return (
    <section className="surface p-5 bg-gradient-to-br from-white via-white to-bay-50">
      <header className="flex items-baseline justify-between">
        <h2 className="font-display text-lg text-slate2-900">{title ?? "Crime mix (last 30 days)"}</h2>
        {data && <span className="text-xs text-slate2-500">{data.totalIncidents.toLocaleString()} incidents</span>}
      </header>
      <p className="mt-1 text-xs text-slate2-500">
        Specific offense types reported by SDPD in the last {data?.windowDays ?? 30} days. Hover a bar for the most-recent occurrence.
      </p>
      {loading && (
        <ul className="mt-4 space-y-2.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="space-y-1.5"><div className="skel h-3 w-3/4" /><div className="skel h-3 w-full" /></li>
          ))}
        </ul>
      )}
      {error && !loading && <p className="mt-3 text-sm text-dusk-700">Couldn&apos;t reach SDPD right now.</p>}
      {!loading && !error && (data?.topOffenses ?? []).length === 0 && (
        <p className="mt-3 text-sm text-slate2-500">No incidents in the last 30 days for this area.</p>
      )}
      {!loading && (data?.topOffenses ?? []).length > 0 && (
        <ul className="mt-4 space-y-3">
          {data!.topOffenses.map((s) => {
            const pct = (s.count / max) * 100;
            const tone = COLOR[s.category];
            return (
              <li key={s.offense} className="group" title={`Last reported ${relativeTime(s.lastOccurredAt)}`}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 text-slate2-900">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${tone.chip.split(" ")[0]}`} />
                    {s.offense}
                  </span>
                  <span className="tabular-nums text-slate2-700">{s.count.toLocaleString()}</span>
                </div>
                <div className="mt-1 h-2.5 rounded-full bg-sand-100 overflow-hidden">
                  <div className="h-full transition-all duration-700 ease-spring group-hover:saturate-150" style={{ width: `${pct}%`, background: tone.bar }} />
                </div>
                <div className="mt-0.5 text-[10px] text-slate2-500">Last reported {relativeTime(s.lastOccurredAt)}</div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
