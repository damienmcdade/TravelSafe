"use client";
import { useEffect, useState } from "react";

interface CityStatus {
  slug: string;
  health: "live" | "warming-up" | "no-data";
  neighborhoodCount: number;
  newestIncidentAt: string | null;
}
interface CoverageResp { cities: CityStatus[]; generatedAt: string }

// Module-level shared fetch. The /cities directory renders 30 of these
// at once; without sharing, each component would fire its own /api/coverage
// call → 30× redundant network. We resolve the promise once and every
// instance reads from the same payload.
let coveragePromise: Promise<CoverageResp> | null = null;
function loadCoverage(): Promise<CoverageResp> {
  if (!coveragePromise) {
    coveragePromise = fetch("/api/coverage")
      .then((r) => (r.ok ? (r.json() as Promise<CoverageResp>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch((err) => {
        // Reset so a later mount can retry — without this a one-time
        // network blip would permanently disable badges for the session.
        coveragePromise = null;
        throw err;
      });
  }
  return coveragePromise;
}

const TONE: Record<CityStatus["health"], { dot: string; label: string }> = {
  "live":       { dot: "bg-sage-500",   label: "Live" },
  "warming-up": { dot: "bg-amber2-500", label: "Warming up" },
  "no-data":    { dot: "bg-dusk-500",   label: "No data yet" },
};

/// Inline status badge for a single city slug. Shows a colored dot +
/// neighborhood count + relative-time freshness once /api/coverage
/// resolves. Renders an unobtrusive placeholder before then so the
/// /cities directory paints instantly and the badges progressively
/// enhance.
export function CityStatusInline({ citySlug }: { citySlug: string }) {
  const [status, setStatus] = useState<CityStatus | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadCoverage()
      .then((d) => {
        if (cancelled) return;
        const match = d.cities.find((c) => c.slug === citySlug);
        if (match) setStatus(match);
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [citySlug]);

  if (error) return null;
  if (!status) {
    // Placeholder: zero-height pulse keeps row height stable while we
    // wait. No flashy spinner — the list is the value here.
    return <span className="block mt-1 h-3 w-24 rounded-full bg-sand-100 animate-pulse" aria-hidden />;
  }

  const tone = TONE[status.health];
  const newest = status.newestIncidentAt ? new Date(status.newestIncidentAt) : null;
  const newestRel = newest ? relativeAgo(Date.now() - newest.getTime()) : null;
  // Single screen-reader-friendly summary so AT users hear the status
  // as one coherent phrase rather than orphaned dot + label + count.
  const srSummary = [
    `Status: ${tone.label}`,
    `${status.neighborhoodCount} ${status.neighborhoodCount === 1 ? "neighborhood" : "neighborhoods"} tracked`,
    newestRel ? `newest report ${newestRel}` : null,
  ].filter(Boolean).join(", ");
  return (
    <span className="mt-1 flex items-center gap-1.5 text-[11px] text-slate2-500" aria-label={srSummary}>
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${tone.dot} ${status.health === "live" ? "animate-pulse" : ""}`}
        aria-hidden
      />
      <span aria-hidden>{tone.label}</span>
      <span aria-hidden>·</span>
      <span className="tabular-nums" aria-hidden>{status.neighborhoodCount} areas</span>
      {newestRel && (
        <>
          <span aria-hidden>·</span>
          <span className="tabular-nums" aria-hidden>{newestRel}</span>
        </>
      )}
    </span>
  );
}

function relativeAgo(diffMs: number): string {
  const s = Math.max(0, Math.round(diffMs / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
