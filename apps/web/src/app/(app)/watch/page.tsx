"use client";
import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { useArea } from "@/lib/use-area";
import { useDocumentTitle } from "@/lib/use-document-title";
import { WheelPicker, type WheelItem } from "@/components/WheelPicker";
import { AreaBriefPanel } from "@/components/AreaBriefPanel";
import { DataFreshnessBanner } from "@/components/DataFreshnessBanner";

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

// Color-tag accents per card group — matches the rest of CommunitySafe's palette.
const GROUP_TAG: Record<WatchCard["group"], { label: string; tone: string; ring: string }> = {
  "official":  { label: "Official",  tone: "text-bay-700",  ring: "ring-bay-200" },
  "reporting": { label: "Reporting", tone: "text-coral-700", ring: "ring-coral-200" },
  "data":      { label: "Local data", tone: "text-amber2-700", ring: "ring-amber2-300/60" },
  "ai":        { label: "AI brief",  tone: "text-sage-700", ring: "ring-sage-200" },
  "civic":     { label: "Get involved", tone: "text-slate2-700", ring: "ring-sand-300" },
};
// Defensive fallback used when a cached response from an older deploy
// surfaces a card with a group label this build doesn't know about. Without
// this guard the render would throw and the whole page would render the
// AppError boundary ("Something went wrong").
const DEFAULT_TAG = { label: "Note", tone: "text-slate2-700", ring: "ring-sand-300" };

export default function NeighborhoodWatchPage() {
  const { city } = useCity();
  // Globally-shared neighborhood selection — picking here propagates to
  // every other tab. The legacy per-tab storage key is gone; the global
  // store is the single source of truth.
  const { area: globalArea, setArea: setGlobalArea } = useArea(city.slug);
  useDocumentTitle(`Neighborhood Watch · ${globalArea?.label ?? city.label}`);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [committedSlug, setCommittedSlug] = useState<string | null>(null);

  // Areas come from /api/geo/areas?city=<slug>. The wrapped shape lets
  // the response carry a "stale" flag when the adapter served a
  // last-known-good list because the fresh upstream pull failed —
  // surfaced as a banner so users see "live feed warming up" instead
  // of "0 neighborhoods" when the city's police feed is briefly down.
  interface GeoAreasResp { areas: Area[]; stale?: boolean; staleMessage?: string }
  const areasPath = `/geo/areas?city=${city.slug}`;
  const { data: areasResp, loading: areasLoading, error: areasErr } = useApi<GeoAreasResp>(areasPath, [areasPath]);
  const cityAreas = useMemo(() => {
    const areas = areasResp?.areas ?? [];
    return areas
      // Tolerate adapters that omit `jurisdiction` (older cached payloads,
      // partial bootstraps) so a single bad row doesn't crash render.
      .filter((a) => (a?.jurisdiction ?? "").toLowerCase() === city.label.toLowerCase())
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [areasResp, city.label]);
  const isStale = areasResp?.stale === true;
  const staleMessage = areasResp?.staleMessage;

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
    // v96 — the effect intentionally depends on globalArea.slug (the
    // string), not the globalArea object. Adding `globalArea` to the
    // deps would re-run on every reference change (e.g., a new fetch
    // result whose slug is identical) and reset the wheel state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div className="space-y-5">
      <header className="page-hero">
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Neighborhood Watch · {city.label}</p>
        <h1 className="mt-1 font-display text-3xl sm:text-4xl leading-tight text-slate2-900">
          Awareness cards <span className="bg-title-stripe bg-clip-text text-transparent break-words">tailored to a specific {city.label} neighborhood</span>
        </h1>
        <p className="mt-2 text-slate2-700 max-w-2xl">
          The cards below name your actual police department, the verified non-emergency line, what gets reported in this area, and how to plug into a real neighborhood-watch program. Every card cites an official source. Pick a different {city.label} neighborhood from the selector at the bottom of the page to rebuild the cards.
        </p>
      </header>


      {isStale && staleMessage && (
        <aside role="status" className="surface-muted px-4 py-3 text-xs text-amber2-700 border border-amber2-300/40 rounded-xl">
          <strong className="text-slate2-900">Live feed warming up.</strong> {staleMessage}
        </aside>
      )}

      {/* Cards section — rendered FIRST so the value of the page is visible
          immediately on landing. The neighborhood selector is now below
          (users overwhelmingly hit this page already wanting cards for the
          area they last picked elsewhere; the wheel is for changing, not
          for first-time discovery). */}
      {!selectedArea && !areasLoading && (
        <section className="surface p-5 text-sm text-slate2-700">
          <p>
            Pick a {city.label} neighborhood from the selector below to see your tailored watch cards.
            The selection syncs with the rest of the app, so if you choose somewhere here you&apos;ll see
            the same area on the Crime Map, Safety Index, and Trend Feed tabs.
          </p>
        </section>
      )}

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

          {/* v99 — honest city-feed recency line (upstream cadence vs freeze). */}
          <DataFreshnessBanner citySlug={city.slug} cityLabel={city.label} />

          {/* v102 — AI Summary self-fetches /ai/area-brief (Railway-proxied,
              where the LLM keys live). It is mounted on `selectedArea` ALONE,
              NOT inside the {watch && !watchLoading} block below: the watch
              payload comes from /neighborhood/watch, which runs locally on a
              cold Vercel function (no Railway proxy) and frequently 504s — and
              when it did, it took the AI Summary down with it (the whole block
              never rendered), which is why the brief appeared "broken" on every
              watch tab even though /ai/area-brief itself returns fine. The /now
              page mounts this same panel on `area` alone, which is why it
              always worked there. Decoupled here to match. */}
          <AreaBriefPanel areaSlug={selectedArea.slug} />

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
                  // AI cards are rendered by the dedicated self-fetch panel
                  // above; skip any server-prerendered "ai" card (always
                  // empty on Vercel) so we don't double up.
                  if (c.group === "ai") return null;
                  const tag = GROUP_TAG[c.group] ?? DEFAULT_TAG;
                  return (
                    <li key={c.id}>
                      <article className={`surface p-5 h-full bg-gradient-to-br from-white to-sand-50 ring-1 ${tag.ring} hover:shadow-glow-bay transition-all animate-rise-in`}>
                        <header className="flex items-baseline justify-between gap-2">
                          <h3 className="font-display text-base text-slate2-900">{c.title}</h3>
                          <span className={`text-[11px] uppercase tracking-wider font-medium ${tag.tone}`}>{tag.label}</span>
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

              <p className="surface-muted p-3 text-xs text-slate2-700 leading-snug" role="note">
                <strong className="text-slate2-900">Methodology:</strong> {watch.disclaimer}
              </p>
            </>
          )}
        </section>
      )}

      {/* Neighborhood selector — moved to the bottom of the page so the
          watch cards land above the fold on entry. The wheel still drives
          the global area store, so picking here updates every other tab. */}
      <section className="surface p-4 sm:p-6">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-display text-lg text-slate2-900">Pick a different {city.label} neighborhood</h2>
            <p className="text-xs text-slate2-500 mt-0.5">
              {cityAreas.length} supported neighborhood{cityAreas.length === 1 ? "" : "s"}. The wheel only shows neighborhoods CommunitySafe tracks for {city.label}.
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
              searchable
              searchPlaceholder={`Search ${city.label} neighborhoods`}
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
    </div>
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
