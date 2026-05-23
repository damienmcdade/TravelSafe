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
    // Lives inside the (app) route group so the global TabNav + footer
    // wrap automatically. Same chrome as every other Browse sub-tab
    // (/threats, /community, /cities) — no bespoke nav needed.
    <main className="space-y-6">
      <header className="page-hero">
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Coverage · System status</p>
        <h1 className="mt-1 font-display text-3xl text-slate2-900">
          {data
            ? `${data.liveCities} of ${data.totalCities} cities live`
            : "System status loading…"}
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
