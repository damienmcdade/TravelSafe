"use client";
import { useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { WheelPicker, type WheelItem } from "./WheelPicker";
import { snapToSupported, useTimeWindow, type WindowValue } from "@/lib/use-time-window";

interface CategoryCounts { PERSONS: number; PROPERTY: number; SOCIETY: number }

interface CitywideResp {
  city: string;
  totalIncidents: number;
  windowDays: number | null;
  perArea: Array<{
    slug: string;
    label: string;
    incidentCount: number;
    byCategory: CategoryCounts;
  }>;
}

const COLORS: Record<keyof CategoryCounts, { bg: string; text: string; label: string; chip: string }> = {
  PERSONS:  { bg: "#357F9C", text: "text-bay-700",   chip: "bg-bay-50 text-bay-700",   label: "Persons" },
  PROPERTY: { bg: "#D26E47", text: "text-coral-700", chip: "bg-coral-50 text-coral-700", label: "Property" },
  SOCIETY:  { bg: "#6C8B62", text: "text-sage-700",  chip: "bg-sage-50 text-sage-700",  label: "Society" },
};

// Plain-English category explanations sourced from FBI NIBRS
// (cde.ucr.cjis.gov). These are the same three crime-against
// groupings the FBI uses to publish national rates, so the labels
// here line up with what users see on /safety-score's national
// comparison and the BlockScore methodology.
const CATEGORY_EXPLAINER: Record<keyof CategoryCounts, { headline: string; body: string; examples: string }> = {
  PERSONS: {
    headline: "Persons — crimes that have a direct victim",
    body:
      "Offenses where a specific person is the target. The FBI groups these under " +
      "\"Crimes Against Persons\" in NIBRS and publishes the national rate against the " +
      "full US population.",
    examples: "Examples: assault, robbery, kidnapping, sex offenses, homicide.",
  },
  PROPERTY: {
    headline: "Property — crimes against a thing, not a person",
    body:
      "Offenses where something owned is stolen, damaged, or unlawfully taken without a " +
      "direct human victim at the scene. FBI publishes a separate national property-crime " +
      "rate per 100,000 residents.",
    examples: "Examples: burglary, theft, motor-vehicle theft, vandalism, arson, fraud.",
  },
  SOCIETY: {
    headline: "Society — public-order offenses",
    body:
      "Offenses against the rules of an orderly society rather than a specific person or " +
      "their property. The FBI tracks these in NIBRS but does NOT publish a national " +
      "per-100k rate for them, so /safety-score's national comparison excludes Society — " +
      "it's only shown here for completeness.",
    examples: "Examples: drug offenses, weapon law violations, DUI, prostitution, gambling.",
  },
};

// Time-interval options for the WheelPicker. Values are days; the API
// translates them into a wall-clock cutoff. "all" → no window, every
// cached incident counts (the adapter's full back-catalogue, which
// varies per city from days to multi-year).
const WINDOW_ITEMS: WheelItem[] = [
  { value: "7",   label: "Last 7 days",     detail: "tight recent slice" },
  { value: "30",  label: "Last 30 days",    detail: "default — recent month" },
  { value: "90",  label: "Last 90 days",    detail: "recent quarter" },
  { value: "180", label: "Last 6 months",   detail: "half-year trend" },
  { value: "365", label: "Last 12 months",  detail: "full annual cycle" },
  { value: "all", label: "All cached data", detail: "every incident the adapter holds" },
];

/// Crime Chart — successor to the legacy Category Mix card. Self-fetches
/// the citywide payload for the user-selected window, then either
/// renders the citywide totals or a single area's slice depending on
/// `mode`. The interval picker is a small WheelPicker drum because the
/// user explicitly asked for a wheel; the four-to-six discrete options
/// fit comfortably without scrolling.
export function CrimeChart({
  mode,
  citySlug,
  cityLabel,
  areaSlug,
  areaLabel,
}: {
  mode: "city" | "area";
  citySlug: string;
  cityLabel: string;
  areaSlug?: string;
  areaLabel?: string;
}) {
  // Shared cross-card window store. Picking a new interval here
  // propagates to TrendPanel (and any other window-aware card) so
  // the user doesn't see one card on 90 days while another silently
  // stayed on 30. Snapped to this card's supported preset list so a
  // value chosen on a card with a wider range (e.g. 180) still maps
  // to one of CrimeChart's options here.
  const { value: rawWindow, setValue: setSharedWindow } = useTimeWindow();
  const CRIME_PRESETS: ReadonlyArray<WindowValue> = [7, 30, 90, 180, 365, "all"];
  const snapped = snapToSupported(rawWindow, CRIME_PRESETS);
  const windowValue: string = snapped === "all" ? "all" : String(snapped);
  const setWindowValue = (next: string) => {
    setSharedWindow(next === "all" ? "all" : Number(next));
  };
  const windowDays = windowValue === "all" ? null : Number(windowValue);
  const path = `/crime-data/citywide?city=${encodeURIComponent(citySlug)}${windowDays != null ? `&windowDays=${windowDays}` : ""}`;
  const { data, loading, error } = useApi<CitywideResp>(path, [path]);

  const counts: CategoryCounts = useMemo(() => {
    if (!data) return { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 };
    if (mode === "city") {
      return data.perArea.reduce(
        (acc, p) => ({
          PERSONS: acc.PERSONS + p.byCategory.PERSONS,
          PROPERTY: acc.PROPERTY + p.byCategory.PROPERTY,
          SOCIETY: acc.SOCIETY + p.byCategory.SOCIETY,
        }),
        { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 },
      );
    }
    return data.perArea.find((p) => p.slug === areaSlug)?.byCategory ?? { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 };
  }, [data, mode, areaSlug]);

  const total = counts.PERSONS + counts.PROPERTY + counts.SOCIETY;
  const subjectLabel = mode === "area" && areaLabel ? areaLabel : `${cityLabel} (citywide)`;
  const entries = (Object.entries(counts) as Array<[keyof CategoryCounts, number]>)
    .sort((a, b) => b[1] - a[1]);
  const windowLabel = WINDOW_ITEMS.find((i) => i.value === windowValue)?.label ?? `Last ${windowValue} days`;

  return (
    <section className="surface p-5">
      <header className="flex items-baseline justify-between flex-wrap gap-1">
        <div>
          <h3 className="font-display text-lg text-slate2-900">Crime Chart</h3>
          <p className="text-xs text-slate2-500 mt-0.5">
            {subjectLabel} · {windowLabel.toLowerCase()}
          </p>
        </div>
        {total > 0 && (
          <span className="text-xs text-slate2-500 tabular-nums">{total.toLocaleString()} incidents</span>
        )}
      </header>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-4">
        <div className="space-y-3">
          {loading && (
            <>
              <div className="skel h-3 w-full" />
              <div className="skel h-3 w-5/6" />
              <div className="skel h-3 w-3/5" />
            </>
          )}
          {!loading && error && (
            <p className="text-sm text-dusk-700">
              Couldn&apos;t reach the {cityLabel} police feed just now. Try a different interval or refresh in a moment.
            </p>
          )}
          {!loading && !error && total === 0 && (
            <p className="text-sm text-slate2-500">
              No incidents reported in {subjectLabel.toLowerCase()} over the {windowLabel.toLowerCase()}.
              Widen the window with the wheel — quieter areas often need a longer interval to register
              a stable mix.
            </p>
          )}
          {!loading && !error && total > 0 && (
            <>
              <div className="flex h-3 rounded-full overflow-hidden bg-sand-100">
                {entries.map(([k, n]) => (
                  <div
                    key={k}
                    className="h-full transition-all duration-500"
                    style={{ width: `${(n / total) * 100}%`, background: COLORS[k].bg }}
                    title={`${COLORS[k].label}: ${n.toLocaleString()}`}
                  />
                ))}
              </div>
              <ul className="space-y-2">
                {entries.map(([k, n]) => {
                  const pct = Math.round((n / total) * 100);
                  return (
                    <li key={k} className="flex items-center gap-3 text-sm">
                      <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[k].bg }} />
                      <span className="text-slate2-900 flex-1">{COLORS[k].label}</span>
                      <span className={`tabular-nums ${COLORS[k].text}`}>{n.toLocaleString()}</span>
                      <span className="text-xs text-slate2-500 tabular-nums w-10 text-right">{pct}%</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <div className="rounded-xl bg-sand-50 ring-1 ring-sand-200 p-2">
          <p className="text-[10px] uppercase tracking-wider text-slate2-500 px-1.5 pb-1">Time interval</p>
          <WheelPicker
            items={WINDOW_ITEMS}
            value={windowValue}
            onChange={setWindowValue}
            height={140}
            rowHeight={32}
            ariaLabel="Crime Chart time interval"
          />
        </div>
      </div>

      <details className="mt-5 group">
        <summary className="cursor-pointer list-none flex items-center gap-1.5 text-xs font-medium text-bay-700 hover:underline select-none">
          <span className="inline-block w-3 transition-transform group-open:rotate-90">›</span>
          What do Persons, Property, and Society mean?
        </summary>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
          {(Object.keys(CATEGORY_EXPLAINER) as Array<keyof CategoryCounts>).map((k) => {
            const x = CATEGORY_EXPLAINER[k];
            const tone = COLORS[k];
            return (
              <div key={k} className="surface-muted p-3 rounded-lg space-y-1.5">
                <span className={`inline-block text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full ${tone.chip}`}>
                  {tone.label}
                </span>
                <p className="text-slate2-900 font-medium leading-snug">{x.headline}</p>
                <p className="text-slate2-700 leading-snug">{x.body}</p>
                <p className="text-slate2-500 italic leading-snug">{x.examples}</p>
              </div>
            );
          })}
        </div>
      </details>
    </section>
  );
}
