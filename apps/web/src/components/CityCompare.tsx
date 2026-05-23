"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { CITIES } from "@/lib/use-city";

interface ScoreRow {
  category: "PERSONS" | "PROPERTY";
  count: number;
  localPer100k: number;
  cityPer100k: number;
  cityDeltaPct: number;
  nationalPer100k: number;
  deltaPct: number;
}
interface ScoreResp {
  city: { slug: string; label: string };
  area: { slug: string; label: string };
  populationEstimate: number;
  windowDays: number;
  asOf: string | null;
  // "N/A" is returned when the underlying adapter has no usable recent
  // data for this city — counts are zero AND confidence is low. The UI
  // renders a neutral "Data unavailable" card rather than a misleading
  // letter grade.
  grade: "A" | "B" | "C" | "D" | "E" | "N/A";
  headline: string;
  rows: ScoreRow[];
  dataConfidence?: "high" | "medium" | "low";
  dataConfidenceNote?: string;
}

const GRADE_TONE: Record<ScoreResp["grade"], { bg: string; ring: string; tone: string; label: string }> = {
  A:     { bg: "bg-sage-100",   ring: "ring-sage-300",   tone: "text-sage-700",   label: "Lower than national" },
  B:     { bg: "bg-sage-50",    ring: "ring-sage-200",   tone: "text-sage-700",   label: "Below national" },
  C:     { bg: "bg-sand-50",    ring: "ring-sand-300",   tone: "text-slate2-700", label: "Near national" },
  D:     { bg: "bg-amber2-50",  ring: "ring-amber2-300", tone: "text-amber2-700", label: "Above national" },
  E:     { bg: "bg-coral-50",   ring: "ring-coral-400",  tone: "text-coral-700",  label: "Higher than national" },
  "N/A": { bg: "bg-slate2-50",  ring: "ring-slate2-200", tone: "text-slate2-500", label: "Data unavailable" },
};

const CAT_LABEL: Record<ScoreRow["category"], string> = {
  PERSONS:  "Violent (persons)",
  PROPERTY: "Property",
};

/// City-vs-city compare. Lives on /cities/[city] (a server-rendered SEO
/// page) as a small client island. User picks another city; we fetch
/// both citywide scores in parallel and render them side-by-side using
/// the same shape as the citywide score card so the visual language
/// matches the rest of the app.
/// The base city's citywide score is already rendered above this
/// component on /cities/[city]/page.tsx. To avoid a duplicate card we
/// only render the COMPARE column here, after the user picks a city.
/// Until then this is just the picker + a brief explainer.
export function CityCompare({ baseCitySlug, baseCityLabel }: { baseCitySlug: string; baseCityLabel: string }) {
  const [compareSlug, setCompareSlug] = useState<string | null>(null);
  const [compareScore, setCompareScore] = useState<ScoreResp | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);

  useEffect(() => {
    if (!compareSlug) { setCompareScore(null); return; }
    let cancelled = false;
    setLoadingCompare(true);
    setCompareScore(null);
    fetch(`/api/safezone/safety-score?city=${compareSlug}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (!cancelled) { setCompareScore(d as ScoreResp); setLoadingCompare(false); } })
      .catch(() => { if (!cancelled) setLoadingCompare(false); });
    return () => { cancelled = true; };
  }, [compareSlug]);

  return (
    <section className="space-y-4">
      <header className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display text-xl text-slate2-900">Compare {baseCityLabel} to another city</h2>
          <p className="text-xs text-slate2-500 mt-0.5">
            Pick a city to render its citywide safety card below — both compared to the FBI national average.
          </p>
        </div>
        <CityCombobox excludeSlug={baseCitySlug} value={compareSlug} onPick={setCompareSlug} />
      </header>

      {compareSlug && (
        <CityScoreCard score={compareScore} loading={loadingCompare} accent="compare" />
      )}
    </section>
  );
}

function CityScoreCard({ score, loading, accent }: { score: ScoreResp | null; loading: boolean; accent?: "primary" | "compare" }) {
  if (loading) return <CityScoreSkeleton />;
  if (!score) return (
    <section className="surface p-5 text-sm text-slate2-700">Couldn&apos;t load this city&apos;s score. Try again in a moment.</section>
  );
  const tone = GRADE_TONE[score.grade];
  return (
    <section className="space-y-3">
      {accent === "compare" && (
        <span className="inline-block text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full bg-bay-100 text-bay-700">
          Comparison
        </span>
      )}
      <section className={`surface p-5 sm:p-6 ring-1 ${tone.ring} ${tone.bg}`}>
        <div className="flex items-center gap-4">
          <div className={`flex items-center justify-center w-16 h-16 rounded-2xl ring-2 ${tone.ring} bg-white text-3xl font-display ${tone.tone}`}>
            {score.grade}
          </div>
          <div>
            <p className={`text-xs uppercase tracking-wider font-medium ${tone.tone}`}>{tone.label}</p>
            <h3 className="mt-0.5 font-display text-lg text-slate2-900">{score.city.label}</h3>
            <p className="mt-1 text-sm text-slate2-700">{score.headline}</p>
          </div>
        </div>
        <div className="mt-3 text-xs text-slate2-500 tabular-nums">
          ~{score.populationEstimate.toLocaleString()} residents · window ~{score.windowDays} days
          {score.asOf && <> · newest report {new Date(score.asOf).toLocaleDateString()}</>}
        </div>
        {score.dataConfidence && score.dataConfidence !== "high" && score.dataConfidenceNote && (
          <p
            role="status"
            className={`mt-3 text-xs px-3 py-2 rounded-lg border leading-snug ${
              score.dataConfidence === "low"
                ? "bg-amber2-50 border-amber2-300/60 text-amber2-700"
                : "bg-sand-50 border-sand-300 text-slate2-700"
            }`}
          >
            <strong className="text-slate2-900">
              {score.dataConfidence === "low" ? "Limited data — grade is provisional." : "Smaller-than-usual data window."}
            </strong>{" "}
            {score.dataConfidenceNote}
          </p>
        )}
      </section>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        {score.rows.map((r) => {
          const above = r.deltaPct > 5;
          const below = r.deltaPct < -5;
          return (
            <li key={r.category} className="surface-muted p-3">
              <p className="text-xs uppercase tracking-wider text-slate2-500">{CAT_LABEL[r.category]}</p>
              <p className="mt-1 text-slate2-900 tabular-nums">
                <strong>{r.localPer100k.toLocaleString()}</strong> / 100k local
              </p>
              <p className={`text-xs tabular-nums ${above ? "text-coral-700" : below ? "text-sage-700" : "text-slate2-500"}`}>
                vs FBI {r.nationalPer100k.toLocaleString()} / 100k national ({r.deltaPct > 0 ? "+" : ""}{r.deltaPct}%)
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CityScoreSkeleton() {
  return (
    <section className="surface p-5 space-y-3">
      <div className="flex items-center gap-4">
        <div className="skel w-16 h-16 rounded-2xl" />
        <div className="flex-1 space-y-2">
          <div className="skel h-3 w-1/3" />
          <div className="skel h-5 w-1/2" />
          <div className="skel h-3 w-3/4" />
        </div>
      </div>
    </section>
  );
}

/// Compact city-search combobox scoped to the comparison flow. Mirrors
/// the header search-bar UX but filters out the base city (you don't
/// compare a city to itself) and refuses coming-soon cities.
function CityCombobox({ excludeSlug, value, onPick }: { excludeSlug: string; value: string | null; onPick: (slug: string | null) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [open]);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = [...CITIES]
      .filter((c) => c.slug !== excludeSlug && c.status === "live")
      .sort((a, b) => a.label.localeCompare(b.label));
    if (!needle) return all;
    return all.filter((c) =>
      c.label.toLowerCase().includes(needle) ||
      c.stateLabel.toLowerCase().includes(needle) ||
      c.state.toLowerCase() === needle,
    );
  }, [q, excludeSlug]);

  const currentLabel = useMemo(
    () => CITIES.find((c) => c.slug === value)?.label,
    [value],
  );

  function pick(slug: string) {
    onPick(slug);
    setOpen(false);
    setQ("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = matches[focusIdx];
      if (m) pick(m.slug);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // Stable ids for WAI-ARIA combobox linkage. excludeSlug is included
  // in the id so multiple CityCompare instances on a page never collide.
  const listboxId = `city-compare-list-${excludeSlug}`;
  const optionId = (slug: string) => `city-compare-opt-${excludeSlug}-${slug}`;
  const activeOption = open && matches[focusIdx];
  return (
    <div ref={wrapRef} className="relative w-full sm:w-72">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setFocusIdx(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={currentLabel ? `Comparing to ${currentLabel} — type to switch` : "Pick a city to compare…"}
        className="input text-sm"
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeOption ? optionId(activeOption.slug) : undefined}
        aria-label="Pick a city to compare"
      />
      {value && (
        <button
          type="button"
          onClick={() => { onPick(null); setQ(""); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate2-500 hover:text-slate2-900 px-1.5 py-0.5"
          aria-label="Clear comparison"
        >
          ×
        </button>
      )}
      {open && matches.length > 0 && (
        <ul id={listboxId} className="absolute z-30 left-0 right-0 mt-1 surface shadow-card-lift max-h-72 overflow-auto p-1" role="listbox" aria-label="Cities to compare against">
          {matches.map((c, i) => (
            <li key={c.slug}>
              <button
                type="button"
                id={optionId(c.slug)}
                onMouseEnter={() => setFocusIdx(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(c.slug); }}
                className={`w-full flex items-baseline justify-between gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                  i === focusIdx ? "bg-bay-100 text-slate2-900" : "hover:bg-sand-100 text-slate2-900"
                }`}
                role="option"
                aria-selected={i === focusIdx}
              >
                <span className="truncate">{c.label}</span>
                <span className="text-[10px] uppercase tracking-wider text-slate2-500 shrink-0">{c.state}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && matches.length === 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 surface shadow-card-lift p-3 text-xs text-slate2-500">
          No live city matches &ldquo;{q}&rdquo;.
        </div>
      )}
    </div>
  );
}
