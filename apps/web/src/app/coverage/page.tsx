"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

interface CityStatus {
  slug: string;
  label: string;
  state: string;
  health: "live" | "warming-up" | "no-data";
  neighborhoodCount: number;
  adapterFetchedAt: string | null;
  newestIncidentAt: string | null;
  source: string;
}
interface CoverageResp {
  generatedAt: string;
  totalCities: number;
  liveCities: number;
  totalNeighborhoods: number;
  cities: CityStatus[];
}

const HEALTH_TONE: Record<CityStatus["health"], { dot: string; label: string; ring: string }> = {
  "live":         { dot: "bg-sage-500",   label: "Live",         ring: "ring-sage-300" },
  "warming-up":   { dot: "bg-amber2-500", label: "Warming up",   ring: "ring-amber2-300" },
  "no-data":      { dot: "bg-dusk-500",   label: "No data yet",  ring: "ring-dusk-300" },
};

/// Public coverage / system status dashboard. Lists every supported
/// city with a live health indicator + last-sync timestamp + neighbor-
/// hood count. Builds trust by showing transparency: users can see at
/// a glance which cities have warm caches and how fresh the underlying
/// data is.
export default function CoveragePage() {
  const [data, setData] = useState<CoverageResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/coverage")
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d) => { if (!cancelled) setData(d as CoverageResp); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <>
      {/* /coverage lives outside the (app) route group so it doesn't
          inherit the TabNav header. Without this sticky top bar users
          who deep-linked or arrived via /cities cross-link have no
          nav to get back to the main app. Renders a TravelSafe brand
          link on the left + an explicit "Back to app" close button on
          the right so the exit is obvious from any viewport. */}
      <header className="bg-white/90 backdrop-blur border-b border-sand-200 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link
            href="/"
            className="font-display text-xl text-slate2-900 transition-colors hover:text-bay-700"
            aria-label="Back to TravelSafe home"
          >
            <span className="bg-gradient-to-r from-bay-700 to-coral-500 bg-clip-text text-transparent">Travel</span>Safe
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate2-700 hover:bg-bay-100 hover:text-bay-700 transition-colors"
            aria-label="Close coverage page and return to home"
          >
            <span>Back to app</span>
            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </Link>
        </div>
      </header>
    <main className="max-w-5xl mx-auto px-4 py-10 space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Coverage · System status</p>
        <h1 className="mt-1 font-display text-3xl text-slate2-900">
          {data ? `${data.liveCities} of ${data.totalCities} cities` : "Loading coverage…"} live
        </h1>
        {data && (
          <p className="mt-2 text-sm text-slate2-700 max-w-2xl">
            {data.totalNeighborhoods.toLocaleString()} neighborhoods discovered across {data.liveCities} active police-data
            feeds. Per-city ping last refreshed {relativeAgo(now - new Date(data.generatedAt).getTime())}.
          </p>
        )}
      </header>

      {error && (
        <p className="surface p-4 text-sm text-dusk-700">
          Couldn&apos;t fetch coverage status: {error}
        </p>
      )}

      {!data && !error && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <li key={i} className="surface p-5 space-y-2">
              <div className="skel h-4 w-1/3" />
              <div className="skel h-3 w-2/3" />
              <div className="skel h-3 w-1/2" />
            </li>
          ))}
        </ul>
      )}

      {data && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.cities.map((c) => {
            const tone = HEALTH_TONE[c.health];
            const newest = c.newestIncidentAt ? new Date(c.newestIncidentAt) : null;
            const fetched = c.adapterFetchedAt ? new Date(c.adapterFetchedAt) : null;
            return (
              <li key={c.slug}>
                <article className={`surface p-5 ring-1 ${tone.ring}`}>
                  <header className="flex items-baseline justify-between gap-2">
                    <div>
                      <h2 className="font-display text-lg text-slate2-900">
                        {c.label}
                        <span className="ml-2 text-xs text-slate2-500 font-normal tabular-nums">{c.state}</span>
                      </h2>
                      <p className="text-xs text-slate2-500 mt-0.5">
                        {c.neighborhoodCount.toLocaleString()} neighborhood{c.neighborhoodCount === 1 ? "" : "s"} tracked
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-2 text-xs">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${tone.dot} ${c.health === "live" ? "animate-pulse" : ""}`}
                        aria-hidden
                      />
                      <span className="font-medium text-slate2-700">{tone.label}</span>
                    </span>
                  </header>

                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <dt className="text-slate2-500">Adapter ping</dt>
                    <dd className="text-slate2-700 tabular-nums text-right">
                      {fetched ? relativeAgo(now - fetched.getTime()) : "—"}
                    </dd>
                    <dt className="text-slate2-500">Newest report</dt>
                    <dd className="text-slate2-700 tabular-nums text-right">
                      {newest ? relativeAgo(now - newest.getTime()) : "—"}
                    </dd>
                  </dl>

                  <p className="mt-4 text-[11px] text-slate2-500 leading-snug">
                    Source: {c.source}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    <Link
                      href="/threats"
                      onClick={() => setCityInStorage(c.slug)}
                      className="text-bay-700 hover:underline"
                    >
                      Open Awareness →
                    </Link>
                    <Link
                      href="/safety-score"
                      onClick={() => setCityInStorage(c.slug)}
                      className="text-bay-700 hover:underline"
                    >
                      Safety Index →
                    </Link>
                    <Link
                      href="/map"
                      onClick={() => setCityInStorage(c.slug)}
                      className="text-bay-700 hover:underline"
                    >
                      Crime Map →
                    </Link>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <p className="surface-muted p-3 text-xs text-slate2-700 leading-snug" role="note">
        <strong className="text-slate2-900">Methodology:</strong> Status is computed by pinging
        each city&apos;s adapter at request time. <strong>Live</strong> means the adapter returned
        a non-empty neighborhood list. <strong>Warming up</strong> means the upstream feed
        didn&apos;t return data this request — where the adapter has a last-known-good cache it
        serves that, so neighborhoods may still appear but can be a few minutes behind.
        <strong>No data yet</strong> means the adapter threw an error (rare; usually a transient
        upstream outage). See{" "}
        <Link href="/methodology" className="text-bay-700 hover:underline">/methodology</Link>{" "}
        for the full breakdown.
      </p>
    </main>
    </>
  );
}

// Set the city slug in localStorage so the destination page lands on
// the right city without a tab switch.
function setCityInStorage(slug: string) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem("travelsafe.city.v1", slug); } catch { /* ignore */ }
}

function relativeAgo(diffMs: number): string {
  const s = Math.max(0, Math.round(diffMs / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d}d ago`;
  return new Date(Date.now() - diffMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
