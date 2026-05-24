"use client";
import { useMemo } from "react";
import { useApi } from "@/lib/api-client";

interface IncidentDispatch {
  at: string;
  text: string;
  kind?: "trend" | "dispatch";
}
interface TrendResp {
  area: { slug: string; label: string };
  bullets: IncidentDispatch[];
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/// 24-bucket histogram of when incidents occur in a neighborhood
/// (local-clock hour-of-day). Helps users plan around peak hours —
/// e.g., a downtown that's quiet 6am-2pm but spikes 8pm-2am tells
/// a different story than one that's evenly distributed.
/// Source: the same trend feed the SafeZone ThreatFeed consumes.
export function TimeOfDayCard({
  areaSlug,
  areaLabel,
}: {
  areaSlug: string;
  areaLabel: string;
}) {
  const { data, loading, error } = useApi<TrendResp>(
    `/safezone/trend?area=${encodeURIComponent(areaSlug)}&label=${encodeURIComponent(areaLabel)}`,
    [areaSlug],
  );

  const buckets = useMemo(() => {
    const out = new Array(24).fill(0) as number[];
    if (!data) return out;
    for (const b of data.bullets) {
      if (b.kind !== "dispatch") continue;
      const t = new Date(b.at);
      if (Number.isNaN(t.getTime())) continue;
      const hr = t.getHours();
      if (hr >= 0 && hr < 24) out[hr] += 1;
    }
    return out;
  }, [data]);

  const total = buckets.reduce((s, n) => s + n, 0);
  const max = Math.max(1, ...buckets);
  // Peak hour for the summary line.
  const peakHour = buckets.indexOf(max);
  const peakLabel = formatHour(peakHour);

  if (loading && !data) return (
    <section className="surface p-5 space-y-2">
      <div className="skel h-4 w-1/3" />
      <div className="mt-2 flex items-end gap-1 h-20">
        {HOURS.map((h) => <div key={h} className="skel flex-1 h-full opacity-50" />)}
      </div>
    </section>
  );
  if (error && !data) return (
    <section className="surface p-5 text-sm text-slate2-500">
      Couldn&apos;t load the hour-of-day pattern right now.
    </section>
  );
  if (!data || total === 0) return null;

  return (
    <section className="surface p-5">
      <header>
        <h3 className="font-display text-lg text-slate2-900">When incidents happen</h3>
        <p className="text-xs text-slate2-500 mt-0.5">
          {total.toLocaleString()} recent dispatches in {areaLabel}, bucketed by local hour. Peak around {peakLabel}.
        </p>
      </header>
      {/* 24-bar histogram. Bars are minimal and use the bay accent
          consistent with other charts. Hour labels appear every
          6 hours so the strip doesn't get crowded. */}
      <div className="mt-4 flex items-end gap-0.5 h-24" role="img" aria-label={`Hour-of-day incident distribution for ${areaLabel}`}>
        {buckets.map((n, h) => {
          const pct = (n / max) * 100;
          return (
            <div
              key={h}
              className="flex-1 bg-bay-200 hover:bg-bay-400 transition-colors rounded-sm relative"
              style={{ height: `${Math.max(2, pct)}%` }}
              title={`${formatHour(h)}: ${n} incident${n === 1 ? "" : "s"}`}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate2-500 tabular-nums">
        <span>12 AM</span>
        <span>6 AM</span>
        <span>Noon</span>
        <span>6 PM</span>
        <span>12 AM</span>
      </div>
    </section>
  );
}

function formatHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h === 12) return "Noon";
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}
