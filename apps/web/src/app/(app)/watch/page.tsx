"use client";
import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { useArea } from "@/lib/use-area";
import { CityBanner } from "@/components/CitySelector";
import { WheelPicker, type WheelItem } from "@/components/WheelPicker";

interface Area { slug: string; label: string; jurisdiction: string }
interface WatchCard {
  id: string;
  title: string;
  body: string;
  source: string;
  sourceUrl: string;
  group: "official" | "reporting" | "data" | "ai" | "civic";
}
interface WatchResp {
  city: { slug: string; label: string };
  area: { slug: string; label: string; jurisdiction: string };
  asOf: string | null;
  windowDays: number;
  totalIncidents: number;
  cards: WatchCard[];
  disclaimer: string;
}

// Color-tag accents per card group — matches the rest of TravelSafe's palette.
const GROUP_TAG: Record<WatchCard["group"], { label: string; tone: string; ring: string }> = {
  "official":  { label: "Official",  tone: "text-bay-700",  ring: "ring-bay-200" },
  "reporting": { label: "Reporting", tone: "text-coral-700", ring: "ring-coral-200" },
  "data":      { label: "Local data", tone: "text-amber2-700", ring: "ring-amber2-300/60" },
  "ai":        { label: "AI brief",  tone: "text-sage-700", ring: "ring-sage-200" },
  "civic":     { label: "Get involved", tone: "text-slate2-700", ring: "ring-sand-300" },
};

export default function NeighborhoodWatchPage() {
  const { city } = useCity();
  // Globally-shared neighborhood selection — picking here propagates to
  // every other tab. The legacy per-tab storage key is gone; the global
  // store is the single source of truth.
  const { area: globalArea, setArea: setGlobalArea } = useArea(city.slug);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [committedSlug, setCommittedSlug] = useState<string | null>(null);

  // Areas come from /api/geo/areas?city=<slug> — the per-city scoped path
  // only fans out ONE adapter discovery on cold cache (2-5s vs the 30s+
  // all-cities call), so the wheel populates quickly. Refetches whenever
  // the user switches city.
  const areasPath = `/geo/areas?city=${city.slug}`;
  const { data: areas, loading: areasLoading, error: areasErr } = useApi<Area[]>(areasPath, [areasPath]);
  const cityAreas = useMemo(() => {
    if (!areas) return [];
    // Adapter discovery already scopes by city; this filter is belt-and-suspenders
    // in case the all-cities path returns (e.g. cached response from before the
    // city query was added) so the wheel never shows another city's areas.
    return areas
      .filter((a) => a.jurisdiction.toLowerCase() === city.label.toLowerCase())
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [areas, city.label]);

  // Seed the wheel from the GLOBAL area whenever it changes (city switch,
  // pick in another tab, or first mount). If no global pick exists, fall
  // back to the first available neighborhood so the wheel always has a
  // valid landing position.
  useEffect(() => {
    if (globalArea) {
      setPendingSlug(globalArea.slug);
      setCommittedSlug(globalArea.slug);
      return;
    }
    setCommittedSlug(null);
    setPendingSlug(null);
  }, [globalArea?.slug, city.slug]);
  useEffect(() => {
    if (pendingSlug || cityAreas.length === 0) return;
    setPendingSlug(cityAreas[0].slug);
  }, [pendingSlug, cityAreas]);

  function commit() {
    if (!pendingSlug) return;
    const next = cityAreas.find((a) => a.slug === pendingSlug);
    if (!next) return;
    setCommittedSlug(pendingSlug);
    // Write to the global store so the rest of the app follows along.
    setGlobalArea({ slug: next.slug, label: next.label, jurisdiction: next.jurisdiction });
  }

  const selectedArea = useMemo(
    () => cityAreas.find((a) => a.slug === committedSlug) ?? null,
    [cityAreas, committedSlug],
  );

  const watchPath = selectedArea
    ? `/neighborhood/watch?area=${encodeURIComponent(selectedArea.slug)}&label=${encodeURIComponent(selectedArea.label)}`
    : null;
  const { data: watch, loading: watchLoading, error: watchErr } = useApi<WatchResp>(watchPath, [watchPath]);

  const wheelItems: WheelItem[] = useMemo(
    () => cityAreas.map((a) => ({ value: a.slug, label: a.label, detail: city.label })),
    [cityAreas, city.label],
  );

  return (
    <main className="space-y-8">
      <header className="page-hero">
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Neighborhood Watch · {city.label}</p>
        <h1 className="mt-1 font-display text-3xl sm:text-4xl text-slate2-900">
          Awareness cards <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x">tailored to a specific {city.label} neighborhood</span>
        </h1>
        <p className="mt-2 text-slate2-700 max-w-2xl">
          Spin the wheel below to pick a neighborhood in {city.label}. The cards on this tab name your actual police department, the verified non-emergency line, what gets reported in this area, and how to plug into a real neighborhood-watch program. Every card cites an official source.
        </p>
      </header>

      <CityBanner />

      <section className="surface p-4 sm:p-6">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-display text-lg text-slate2-900">Pick a {city.label} neighborhood</h2>
            <p className="text-xs text-slate2-500 mt-0.5">
              {cityAreas.length} supported neighborhood{cityAreas.length === 1 ? "" : "s"}. The wheel only shows neighborhoods TravelSafe tracks for {city.label}.
            </p>
          </div>
          <button
            onClick={commit}
            disabled={!pendingSlug || pendingSlug === committedSlug}
            className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {committedSlug === pendingSlug && committedSlug ? "Showing" : "Show this neighborhood"}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-start">
          {areasLoading ? (
            <div className="surface-muted p-8 text-center text-sm text-slate2-500 animate-pulse">
              Loading {city.label} neighborhoods…
            </div>
          ) : cityAreas.length === 0 ? (
            // areasErr fires when the police adapter call timed out or the
            // upstream feed is briefly unreachable — distinguish that from
            // a city that legitimately has no published neighborhoods so the
            // user can retry rather than blame the data.
            <div className="surface-muted p-8 text-center text-sm text-slate2-700">
              {areasErr ? (
                <>
                  <p className="font-medium text-slate2-900">Could not reach the {city.label} police feed just now.</p>
                  <p className="mt-1.5 text-xs text-slate2-500">
                    The data source is sometimes slow on the first request after a deploy. Switch tabs or wait ~10 seconds, then come back — the wheel will populate from the same official feed that powers the Crime Map.
                  </p>
                </>
              ) : (
                <p>No neighborhoods are tracked for {city.label} yet. Pick a different city in the header.</p>
              )}
            </div>
          ) : (
            <WheelPicker
              items={wheelItems}
              value={pendingSlug ?? wheelItems[0]?.value ?? ""}
              onChange={setPendingSlug}
              ariaLabel={`Neighborhoods in ${city.label}`}
              height={224}
              rowHeight={36}
            />
          )}

          <div className="surface-muted p-4 text-xs text-slate2-700 leading-snug max-w-xs">
            <p className="font-medium text-slate2-900">How this tab works</p>
            <ul className="mt-2 space-y-1.5 list-disc pl-4">
              <li>Cards rebuild from scratch every time you pick a different {city.label} neighborhood.</li>
              <li>Every card links to its source — your own police department, DOJ guidance, or the same crime feed the rest of the app uses.</li>
              <li>Nothing here is personal advice or a verdict on a neighborhood — just verified context.</li>
            </ul>
          </div>
        </div>
      </section>

      {selectedArea && (
        <section className="space-y-3">
          <header className="flex items-baseline justify-between flex-wrap gap-2">
            <h2 className="font-display text-xl text-slate2-900">
              {selectedArea.label}, {city.label}
            </h2>
            {watch && (
              <span className="text-xs text-slate2-500 tabular-nums">
                {watch.totalIncidents.toLocaleString()} incidents in cache
                {watch.windowDays > 0 && ` · ~${watch.windowDays} days`}
              </span>
            )}
          </header>

          {watchLoading && <CardGridSkeleton />}
          {watchErr && !watchLoading && (
            <p className="surface p-4 text-sm text-dusk-700">
              Couldn&apos;t load the watch cards for {selectedArea.label}. Try again in a moment — the police feed may be warming up.
            </p>
          )}
          {watch && !watchLoading && (
            <>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {watch.cards.map((c) => {
                  const tag = GROUP_TAG[c.group];
                  return (
                    <li key={c.id}>
                      <article className={`surface p-5 h-full bg-gradient-to-br from-white to-sand-50 ring-1 ${tag.ring} hover:shadow-glow-bay transition-all animate-rise-in`}>
                        <header className="flex items-baseline justify-between gap-2">
                          <h3 className="font-display text-base text-slate2-900">{c.title}</h3>
                          <span className={`text-[10px] uppercase tracking-wider font-medium ${tag.tone}`}>{tag.label}</span>
                        </header>
                        <p className="mt-2 text-sm text-slate2-700 leading-snug whitespace-pre-wrap">{c.body}</p>
                        <a
                          href={c.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex items-center gap-1 text-xs text-bay-700 hover:underline"
                        >
                          Source: {c.source} →
                        </a>
                      </article>
                    </li>
                  );
                })}
              </ul>

              <p className="surface-muted p-3 text-xs text-slate2-700 leading-snug">
                {watch.disclaimer}
              </p>
            </>
          )}
        </section>
      )}
    </main>
  );
}

function CardGridSkeleton() {
  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <li key={i} className="surface p-5 space-y-2">
          <div className="skel h-4 w-1/2" />
          <div className="skel h-3 w-full" />
          <div className="skel h-3 w-5/6" />
          <div className="skel h-3 w-4/6" />
        </li>
      ))}
    </ul>
  );
}
