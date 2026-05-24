"use client";
import { useMemo } from "react";
import { useApi } from "@/lib/api-client";

interface CitywideResp {
  city: string;
  totalIncidents: number;
  perArea: Array<{
    slug: string;
    label: string;
    incidentCount: number;
    riskLevel: 1 | 2 | 3 | 4 | 5;
    byCategory: { PERSONS: number; PROPERTY: number; SOCIETY: number };
  }>;
}

/// Top-N most-active neighborhoods in the user's selected city. Self-
/// fetching, click-through wires the global useArea so clicking
/// switches everything else (Safety Score, Crime Chart) to that area.
/// Distinct from the existing "Neighborhoods by recent incident
/// count" list on the citywide threats view in that it deliberately
/// stays compact (top 5 only) and shows the dominant offense
/// category per area for at-a-glance triage.
export function HotspotCard({
  citySlug,
  cityLabel,
  onPickArea,
  topN = 5,
}: {
  citySlug: string;
  cityLabel: string;
  onPickArea?: (slug: string, label: string) => void;
  topN?: number;
}) {
  const { data, loading, error } = useApi<CitywideResp>(
    `/crime-data/citywide?city=${encodeURIComponent(citySlug)}`,
    [citySlug],
  );
  const hot = useMemo(() => {
    if (!data) return [];
    return [...data.perArea]
      .sort((a, b) => b.incidentCount - a.incidentCount)
      .slice(0, topN);
  }, [data, topN]);
  const max = hot[0]?.incidentCount ?? 1;

  if (loading && !data) return (
    <section className="surface p-5 space-y-2">
      <div className="skel h-4 w-1/3" />
      <div className="space-y-1.5 mt-2">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skel h-3 w-full" />)}
      </div>
    </section>
  );
  if (error && !data) return (
    <section className="surface p-5 text-sm text-slate2-500">
      Couldn&apos;t load hotspots for {cityLabel} right now.
    </section>
  );
  if (!data || hot.length === 0) return null;

  return (
    <section className="surface p-5">
      <header>
        <h3 className="font-display text-lg text-slate2-900">Current hotspots</h3>
        <p className="text-xs text-slate2-500 mt-0.5">
          Top {hot.length} most-active neighborhoods in {cityLabel} right now. Click to focus the rest of the page on that area.
        </p>
      </header>
      <ol className="mt-3 space-y-2 text-sm">
        {hot.map((a) => {
          const pct = (a.incidentCount / max) * 100;
          const dominant = (Object.entries(a.byCategory) as Array<[string, number]>)
            .sort((x, y) => y[1] - x[1])[0]?.[0] ?? "—";
          const Wrap = onPickArea ? "button" : "div";
          return (
            <li key={a.slug}>
              <Wrap
                onClick={onPickArea ? () => onPickArea(a.slug, a.label) : undefined}
                className={`w-full text-left ${onPickArea ? "group cursor-pointer" : ""}`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className={`text-slate2-900 ${onPickArea ? "group-hover:text-bay-700 transition-colors" : ""}`}>{a.label}</span>
                  <span className="text-xs text-slate2-500 tabular-nums">{a.incidentCount.toLocaleString()} · {dominant.toLowerCase()}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-sand-100 overflow-hidden">
                  <div className="h-full bg-bay-500 transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
              </Wrap>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
