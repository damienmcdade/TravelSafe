"use client";
import { useEffect, useMemo, useState } from "react";
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

export function NewsPanel({ areaSlug }: { areaSlug?: string }) {
  const { city } = useCity();
  const path = areaSlug
    ? `/news?area=${encodeURIComponent(areaSlug)}&city=${city.slug}`
    : `/news?city=${city.slug}`;
  const { data, loading, error } = useApi<Resp>(path, [areaSlug, city.slug]);
  const items = data?.items ?? [];

  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [showPicker, setShowPicker] = useState(false);
  const [expanded, setExpanded] = useState(false);
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
    <section className="surface p-5 flex flex-col">
      <header className="flex items-baseline justify-between flex-wrap gap-1">
        <h3 className="font-display text-lg text-slate2-900">What&apos;s being reported</h3>
        <button
          onClick={() => setShowPicker((s) => !s)}
          className="text-xs text-bay-700 hover:underline"
          aria-expanded={showPicker}
        >
          {showPicker ? "Hide source picker" : `Pick sources${hidden.size ? ` (${hidden.size} hidden)` : ""}`}
        </button>
      </header>
      <p className="mt-1 text-xs text-slate2-500">
        Headlines for {city.label}, past 7 days. Duplicates are merged server-side. Click any headline to read the article at its original source.
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
        <p className="mt-3 text-sm text-dusk-700">Could not load news right now. The Google News feed may be rate-limited; please try again in a minute.</p>
      )}
      {!loading && !error && visibleItems.length === 0 && items.length > 0 && (
        <p className="mt-3 text-sm text-slate2-500">All sources are hidden. Use the source picker to enable some.</p>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="mt-3 text-sm text-slate2-500">No matching headlines in the past week for {city.label}. Quiet news is generally good news.</p>
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
    </section>
  );
}
