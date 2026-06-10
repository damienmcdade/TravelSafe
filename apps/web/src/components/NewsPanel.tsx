"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { relativeTime } from "@/lib/sse";

interface NewsItem {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  snippet?: string;
}
interface Resp { source: string; query: string; items: NewsItem[]; disclaimer: string }

const STORAGE_KEY = "travelsafe.news.sources.v1";
const WINDOW_STORAGE_KEY = "travelsafe.news.window.v1";

// Time-window choices for the Google News `when:Nd` operator. 30
// days is the default per product requirement; other options give
// users a sliding range from "very recent" to "this entire season".
const NEWS_WINDOWS: Array<{ value: number; label: string }> = [
  { value: 7,   label: "Last 7 days" },
  { value: 14,  label: "Last 14 days" },
  { value: 30,  label: "Last 30 days" },
  { value: 60,  label: "Last 60 days" },
  { value: 90,  label: "Last 90 days" },
  { value: 180, label: "Last 6 months" },
];

function readPrefs(): { hidden: string[] } {
  if (typeof window === "undefined") return { hidden: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { hidden: [] };
    const parsed = JSON.parse(raw);
    return { hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [] };
  } catch {
    return { hidden: [] };
  }
}

function writePrefs(p: { hidden: string[] }) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

// Default visible count. Keeps the panel a predictable height so the
// right-side aside doesn't tower over the left-side analytics column —
// the audit caught the gap that pattern created. Users who want more
// can expand via the "Show all" disclosure below.
const DEFAULT_VISIBLE = 5;

export function NewsPanel({ areaSlug, defaultOpen = false }: { areaSlug?: string; defaultOpen?: boolean }) {
  const { city } = useCity();
  // Time-window state, hydrated from localStorage so the user's pick
  // survives tab switches + cross-page navigation. Default 30d per
  // product requirement. SSR returns 30; client useEffect overwrites
  // with stored value on first commit.
  const [windowDays, setWindowDaysState] = useState<number>(30);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(WINDOW_STORAGE_KEY);
      const parsed = stored ? Number(stored) : NaN;
      if (Number.isFinite(parsed) && NEWS_WINDOWS.some((w) => w.value === parsed)) {
        setWindowDaysState(parsed);
      }
    } catch { /* ignore */ }
  }, []);
  const setWindowDays = useCallback((next: number) => {
    setWindowDaysState(next);
    try { window.localStorage.setItem(WINDOW_STORAGE_KEY, String(next)); } catch { /* ignore */ }
  }, []);
  const path = areaSlug
    ? `/news?area=${encodeURIComponent(areaSlug)}&city=${city.slug}&windowDays=${windowDays}`
    : `/news?city=${city.slug}&windowDays=${windowDays}`;
  const { data, loading, error } = useApi<Resp>(path, [areaSlug, city.slug, windowDays]);
  // v96 — was `const items = data?.items ?? []` but the `?? []`
  // produced a fresh array on every render, which made the two
  // useMemo dependencies below recompute even when nothing changed.
  // Wrap in its own useMemo keyed on data so the array identity is
  // stable while data is stable.
  const items = useMemo(() => data?.items ?? [], [data]);

  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [showPicker, setShowPicker] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // v67 — panel-level collapse so the news card doesn't dominate the
  // page on landing. Distinct from `expanded` (which controls
  // show-more inside the rendered list). Collapsed-by-default per
  // the long-cards directive; user-toggleable; resets when they
  // navigate between cities/areas (so the new area's news starts
  // collapsed too rather than inheriting a previous open state).
  const [panelOpen, setPanelOpen] = useState(defaultOpen);
  useEffect(() => { setPanelOpen(defaultOpen); }, [city.slug, areaSlug, defaultOpen]);
  useEffect(() => { setHidden(new Set(readPrefs().hidden)); }, []);
  // Reset to collapsed whenever the city changes — switching cities
  // brings in a brand-new feed and the user should re-decide whether
  // to expand.
  useEffect(() => { setExpanded(false); }, [city.slug, areaSlug]);

  const sourceCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) m.set(it.source, (m.get(it.source) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const visibleItems = useMemo(
    () => items.filter((i) => !hidden.has(i.source)),
    [items, hidden],
  );

  function toggleSource(s: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      writePrefs({ hidden: Array.from(next) });
      return next;
    });
  }

  function reset() {
    setHidden(new Set());
    writePrefs({ hidden: [] });
  }

  const displayItems = expanded ? visibleItems : visibleItems.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = visibleItems.length - displayItems.length;

  return (
    <section className="surface p-4 sm:p-5 flex flex-col">
      {/* v67 — panel-level collapse toggle. Renders the headline only
          when collapsed so the news card doesn't crowd the page on
          landing. Source picker + window selector + body all live in
          the expanded branch. */}
      <button
        type="button"
        onClick={() => setPanelOpen(!panelOpen)}
        aria-expanded={panelOpen}
        className="w-full flex items-center justify-between gap-3 text-left hover:bg-bay-50/40 rounded-md -m-1 p-1 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden="true" className={`inline-block transition-transform text-slate2-500 text-sm shrink-0 ${panelOpen ? "rotate-90" : ""}`}>▶</span>
          <h3 className="font-display text-lg text-slate2-900 truncate">What&apos;s being reported</h3>
        </div>
        {visibleItems.length > 0 && (
          <span className="text-xs text-slate2-500 shrink-0 tabular-nums">{visibleItems.length} headlines</span>
        )}
      </button>
      {!panelOpen ? null : <>
      <header className="mt-3 flex items-baseline justify-between flex-wrap gap-1">
        <button
          onClick={() => setShowPicker((s) => !s)}
          className="text-xs text-bay-700 hover:underline ml-auto"
          aria-expanded={showPicker}
        >
          {showPicker ? "Hide source picker" : `Pick sources${hidden.size ? ` (${hidden.size} hidden)` : ""}`}
        </button>
      </header>
      {/* Time-window selector. Surfaced inline (not buried in
          settings) because the requirement was for the user to pick
          how far back the articles go right next to the headline
          list. Persists via localStorage so the choice survives
          tab + page navigation. */}
      <div className="mt-2 flex items-center gap-2 text-xs">
        <label htmlFor="news-window" className="text-slate2-500 shrink-0">Time range:</label>
        <select
          id="news-window"
          value={windowDays}
          onChange={(e) => setWindowDays(Number(e.target.value))}
          className="surface-muted border-0 rounded-md px-2 py-1 text-slate2-900 text-xs cursor-pointer hover:bg-bay-50 focus:outline-none focus:ring-2 focus:ring-bay-500"
        >
          {NEWS_WINDOWS.map((w) => (
            <option key={w.value} value={w.value}>{w.label}</option>
          ))}
        </select>
      </div>
      <p className="mt-2 text-xs text-slate2-500">
        Headlines {areaSlug ? "for this neighborhood" : `for ${city.label}`}, {NEWS_WINDOWS.find((w) => w.value === windowDays)?.label.toLowerCase() ?? `past ${windowDays} days`}. Duplicates merged server-side. Click any headline to read the article at its original source.
      </p>

      {showPicker && (
        <div className="mt-3 surface-muted p-3 text-sm animate-pop-in">
          <p className="text-xs text-slate2-700 mb-2">
            Uncheck a source to hide its articles. Your preferences are saved locally.
          </p>
          {sourceCounts.length === 0 ? (
            <p className="text-xs text-slate2-500">No sources to filter yet — wait for headlines to load.</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
              {sourceCounts.map(([src, n]) => (
                <li key={src}>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!hidden.has(src)}
                      onChange={() => toggleSource(src)}
                      className="h-3.5 w-3.5 accent-bay-500"
                    />
                    <span className="text-slate2-900">{src}</span>
                    <span className="text-xs text-slate2-500">({n})</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {hidden.size > 0 && (
            <button onClick={reset} className="mt-3 text-xs text-coral-700 hover:underline">
              Show all sources
            </button>
          )}
        </div>
      )}

      {loading && (
        <ul className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="space-y-2"><div className="skel h-3 w-3/4" /><div className="skel h-2 w-1/2" /></li>
          ))}
        </ul>
      )}
      {error && !loading && (
        <p className="mt-3 text-sm text-dusk-700">Could not load news right now. The Google News feed may be rate-limited; try again in a moment.</p>
      )}
      {!loading && !error && visibleItems.length === 0 && items.length > 0 && (
        <p className="mt-3 text-sm text-slate2-500">All sources are hidden. Use the source picker to enable some.</p>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="mt-3 text-sm text-slate2-500">
          {/* v64 — was hardcoded "past week" even when picker was set
              to 30d / 90d. Now reflects actual selection so trust
              isn't broken when label and content diverge. */}
          No matching headlines in {NEWS_WINDOWS.find((w) => w.value === windowDays)?.label.toLowerCase() ?? `the past ${windowDays} days`} for {city.label}. Quiet news is generally good news.
        </p>
      )}
      {!loading && visibleItems.length > 0 && (
        <>
          <ul className="mt-4 divide-y divide-sand-200">
            {displayItems.map((item, i) => (
              <li key={`${item.link}-${i}`} className="py-3">
                <a href={item.link} target="_blank" rel="noreferrer" className="block group">
                  <span className="block text-sm text-slate2-900 group-hover:text-bay-700 transition-colors leading-snug">
                    {item.title}
                  </span>
                  <span className="block mt-1 text-xs text-slate2-500">
                    {item.source} · {relativeTime(item.publishedAt)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {(hiddenCount > 0 || expanded) && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              className="mt-2 text-xs text-bay-700 hover:underline self-start"
            >
              {expanded
                ? `Show fewer (back to ${DEFAULT_VISIBLE})`
                : `Show ${hiddenCount} more ${hiddenCount === 1 ? "article" : "articles"}`}
            </button>
          )}
        </>
      )}
      </>}
    </section>
  );
}
