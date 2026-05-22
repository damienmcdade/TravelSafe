"use client";
import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
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
  // Per-tab persistence of the user's pick within a city — so switching to
  // CommunitySafe and back returns to the same neighborhood.
  const storageKey = `travelsafe.watch.area.${city.slug}`;
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [committedSlug, setCommittedSlug] = useState<string | null>(null);

  // Areas come from /api/geo/areas — same source the rest of the app uses.
  // We filter to the active city by jurisdiction (label) so the wheel only
  // shows neighborhoods the user can actually drill into.
  const { data: areas, loading: areasLoading } = useApi<Area[]>("/geo/areas");
  const cityAreas = useMemo(() => {
    if (!areas) return [];
    return areas
      .filter((a) => a.jurisdiction.toLowerCase() === city.label.toLowerCase())
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [areas, city.label]);

  // Restore the last selected neighborhood for THIS city, else default to
  // the first available one. Reset every time the city changes.
  useEffect(() => {
    setCommittedSlug(null);
    setPendingSlug(null);
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) setPendingSlug(stored);
    } catch { /* ignore */ }
  }, [city.slug, storageKey]);
  useEffect(() => {
    if (pendingSlug || cityAreas.length === 0) return;
    setPendingSlug(cityAreas[0].slug);
  }, [pendingSlug, cityAreas]);

  function commit() {
    if (!pendingSlug) return;
    setCommittedSlug(pendingSlug);
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem(storageKey, pendingSlug); } catch { /* ignore */ }
    }
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
          {areasLoading || cityAreas.length === 0 ? (
            <div className="surface-muted p-8 text-center text-sm text-slate2-500 animate-pulse">
              {areasLoading
                ? `Loading ${city.label} neighborhoods…`
                : `No neighborhoods are available yet for ${city.label}. Try a different city in the selector above.`}
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
