"use client";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { useArea } from "@/lib/use-area";

interface UptickEntry {
  area: { slug: string; label: string };
  priorCount: number;
  recentCount: number;
  multiplier: number;
}
interface UpticksResponse {
  city: { slug: string; label: string };
  windowDays: number;
  generatedAt: string;
  upticks: UptickEntry[];
}

/// Surfaces neighborhoods with significant 7-day-over-7-day report
/// jumps. Empty state is intentional — "no notable upticks" is genuine
/// good news for a city in a given week, not a bug.
export function UptickTile() {
  const { city } = useCity();
  const { setArea } = useArea(city.slug);
  const { data, loading, error } = useApi<UpticksResponse>(
    `/crime-data/upticks?city=${city.slug}`,
    [city.slug],
  );

  return (
    <section className="surface p-5 min-h-[180px] flex flex-col">
      <header className="flex items-baseline justify-between flex-wrap gap-1">
        <h2 className="font-display text-lg text-slate2-900">Recent upticks in {city.label}</h2>
        <span className="text-xs text-slate2-500">prior 7 days → last 7 days</span>
      </header>
      <p className="mt-1 text-xs text-slate2-500">
        Neighborhoods where the last 7 days reported notably more incidents than the 7 days before that.
        Click one to drill in.
      </p>

      {loading && !data && (
        <ul className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <li key={i} className="space-y-1">
              <div className="skel h-3 w-2/3" />
              <div className="skel h-2 w-1/2" />
            </li>
          ))}
        </ul>
      )}

      {error && !loading && (
        <p className="mt-3 text-sm text-dusk-700">
          Couldn&apos;t compute upticks for {city.label}. The police feed may be warming up.
        </p>
      )}

      {data && !loading && data.upticks.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-center">
          <p className="text-sm text-slate2-500 max-w-xs">
            No notable upticks in {city.label} this week. That&apos;s genuinely good news — week-over-week
            counts are stable or down across every tracked neighborhood.
          </p>
        </div>
      )}

      {data && data.upticks.length > 0 && (
        <ol className="mt-3 divide-y divide-sand-200">
          {data.upticks.map((u) => (
            <li key={u.area.slug} className="py-2">
              <button
                onClick={() => setArea({ slug: u.area.slug, label: u.area.label, jurisdiction: city.label })}
                aria-label={`View ${u.area.label} — ${Number(u.multiplier ?? 0).toFixed(1)}× uptick, ${u.priorCount} to ${u.recentCount} incidents`}
                className="w-full text-left group flex items-baseline gap-3"
              >
                <span className="text-slate2-900 group-hover:text-bay-700 transition-colors flex-1 truncate">
                  {u.area.label}
                </span>
                <span className="text-xs text-coral-700 font-medium tabular-nums shrink-0">
                  {Number(u.multiplier ?? 0).toFixed(1)}×
                </span>
                <span className="text-xs text-slate2-500 tabular-nums shrink-0">
                  {u.priorCount} → {u.recentCount}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
