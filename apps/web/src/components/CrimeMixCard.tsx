"use client";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { relativeTime } from "@/lib/sse";

interface Slice { offense: string; category: "PERSONS" | "PROPERTY" | "SOCIETY"; count: number; lastOccurredAt: string }
interface Mix { area: string; windowDays: number; asOf: string | null; totalIncidents: number; topOffenses: Slice[] }

// Aligned with the rest of the app's muted palette: PERSONS = terracotta,
// PROPERTY = sand-gold, SOCIETY = slate-teal. The previous mapping shuffled
// the category-color pairs AND used the old bright-saturation tones.
const COLOR: Record<Slice["category"], { bar: string; chip: string; iconBg: string }> = {
  PERSONS:  { bar: "linear-gradient(90deg, #FCA5A5, #DC2626)",  chip: "bg-coral-100 text-coral-700",   iconBg: "bg-coral-100" },
  PROPERTY: { bar: "linear-gradient(90deg, #FCD34D, #F59E0B)",  chip: "bg-amber2-100 text-amber2-700", iconBg: "bg-amber2-100" },
  SOCIETY:  { bar: "linear-gradient(90deg, #93C5FD, #2563EB)",  chip: "bg-bay-100 text-bay-700",       iconBg: "bg-bay-100" },
};

const SOURCE_LABEL: Record<string, string> = {
  "san-diego":     "SDPD NIBRS",
  "los-angeles":   "LAPD Crime Data",
  "san-francisco": "SFPD Incident Reports",
  "chicago":       "Chicago CPD",
  "seattle":       "Seattle PD",
  "new-york":      "NYPD Complaint Data",
  "denver":        "Denver Open Data",
  "detroit":       "Detroit RMS",
  "washington-dc": "DC MPD",
  "boston":        "Boston BPD",
  "philadelphia":  "Philadelphia PPD",
};

export function CrimeMixCard({ areaSlug, jurisdictionSlug, title }: { areaSlug?: string; jurisdictionSlug?: string; title?: string }) {
  const { city } = useCity();
  const path = areaSlug ? `/crime-data/mix?neighborhood=${areaSlug}` : jurisdictionSlug ? `/crime-data/mix?jurisdiction=${jurisdictionSlug}` : null;
  const { data, loading, error } = useApi<Mix>(path, [path]);
  const max = Math.max(1, ...(data?.topOffenses ?? []).map((o) => o.count));
  const sourceLabel = SOURCE_LABEL[city.slug] ?? `${city.label} police data`;
  const windowText = (() => {
    if (!data || data.totalIncidents === 0) return "";
    const days = data.windowDays;
    if (days < 14)  return `last ${days} days`;
    if (days < 60)  return `last ~${Math.round(days/7)} weeks`;
    if (days < 365) return `last ~${Math.round(days/30)} months`;
    return `past ${(days/365).toFixed(1)} years`;
  })();

  return (
    <section className="surface p-5 bg-gradient-to-br from-white via-white to-bay-50 min-h-[220px] flex flex-col">
      <header className="flex items-baseline justify-between flex-wrap gap-1">
        <h2 className="font-display text-lg text-slate2-900">{title ?? "Specific offenses"}</h2>
        {data && data.totalIncidents > 0 && (
          <span className="text-xs text-slate2-500 tabular-nums">{data.totalIncidents.toLocaleString()} incidents · {windowText}</span>
        )}
      </header>
      <p className="mt-1 text-xs text-slate2-500">
        Top reported offense types from {sourceLabel}{data?.asOf ? `. Most recent report ${relativeTime(data.asOf)}` : ""}. Hover a bar for the most-recent occurrence of that offense.
      </p>
      {loading && (
        <ul className="mt-4 space-y-2.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="space-y-1.5"><div className="skel h-3 w-3/4" /><div className="skel h-3 w-full" /></li>
          ))}
        </ul>
      )}
      {error && !loading && <p className="mt-3 text-sm text-dusk-700">Could not reach the {city.label} police data feed right now.</p>}
      {!loading && !error && (data?.topOffenses ?? []).length === 0 && (
        <p className="mt-3 text-sm text-slate2-500">No incidents from {sourceLabel} for this area in the recent cached window.</p>
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
