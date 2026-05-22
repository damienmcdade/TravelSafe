"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { CityBanner } from "@/components/CitySelector";

const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => (
    <div className="surface h-[55vh] min-h-[420px] flex items-center justify-center text-slate2-500 animate-pulse">
      Loading map…
    </div>
  ),
});

interface Area { slug: string; label: string; jurisdiction: string; centroid: { lat: number; lng: number } }
interface LookupResult { area: Area; matchedVia: "exact" | "zip" | "fuzzy" | "geocode"; rawQuery: string }

export interface RouteAlt {
  coordinates: Array<[number, number]>;
  durationSec: number;
  distanceMeters: number;
  exposureScore: number;
  exposurePer100k: number;
  passesThrough: string[];
  headline: string;
  rating: "A" | "B" | "C" | "D" | "E";
}
interface RouteResp {
  city: { slug: string; label: string };
  from: { lat: number; lng: number };
  to:   { lat: number; lng: number };
  mode: "walking" | "driving" | "transit";
  routes: RouteAlt[];
  source: { label: string; url: string };
  disclaimer: string;
}

// Calm gradient: sage → slate-teal → sand → amber → terracotta. Every
// route gets a meaningful color without anything looking like a hazard
// strip. Strokes are picked so the polyline reads as data, not warning.
const RATING_TONE: Record<RouteAlt["rating"], { stroke: string; tone: string; label: string }> = {
  A: { stroke: "#7BA86E", tone: "text-sage-700",   label: "Safest of the alternatives" },
  B: { stroke: "#5C8AA7", tone: "text-bay-700",    label: "Lower exposure" },
  C: { stroke: "#94a3b8", tone: "text-slate2-700", label: "Mid exposure" },
  D: { stroke: "#CBA56C", tone: "text-amber2-700", label: "Higher exposure" },
  E: { stroke: "#C47C62", tone: "text-amber2-700", label: "Highest exposure" },
};

const MODES: Array<{ value: "walking" | "driving" | "transit"; label: string; hint: string }> = [
  { value: "walking",  label: "Walking",  hint: "Pedestrian routing via OSM foot profile" },
  { value: "driving",  label: "Driving",  hint: "Vehicle routing via OSM driving profile" },
  { value: "transit",  label: "Transit",  hint: "Driving-route proxy until OTP integration" },
];

export default function SafeRoutePage() {
  const { city } = useCity();
  const [fromQ, setFromQ] = useState("");
  const [toQ, setToQ] = useState("");
  const [mode, setMode] = useState<"walking" | "driving" | "transit">("walking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RouteResp | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  async function compute() {
    setBusy(true); setError(null); setResult(null);
    try {
      const f = fromQ.trim();
      const t = toQ.trim();
      if (!f || !t) { setError("Enter both a from and a to."); return; }
      // Resolve both endpoints via /api/geo/lookup. Falls back to the city
      // centroid if either side doesn't match a known area or geocode.
      const [fromR, toR] = await Promise.all([
        api<LookupResult>(`/geo/lookup?q=${encodeURIComponent(f)}`).catch(() => null),
        api<LookupResult>(`/geo/lookup?q=${encodeURIComponent(t)}`).catch(() => null),
      ]);
      if (!fromR) { setError(`Couldn't match "${f}" — try a neighborhood, ZIP, or landmark.`); return; }
      if (!toR)   { setError(`Couldn't match "${t}" — try a neighborhood, ZIP, or landmark.`); return; }
      const r = await api<RouteResp>(
        `/route/safe?fromLat=${fromR.area.centroid.lat}&fromLng=${fromR.area.centroid.lng}` +
        `&toLat=${toR.area.centroid.lat}&toLng=${toR.area.centroid.lng}&mode=${mode}`,
      );
      setResult(r);
      setSelectedIdx(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="space-y-6">
      <header className="page-hero">
        <p className="text-xs uppercase tracking-[0.18em] text-bay-700 font-medium">Safe Route · {city.label}</p>
        <h1 className="mt-1 font-display text-3xl sm:text-4xl text-slate2-900">
          Pick the <span className="bg-title-stripe bg-clip-text text-transparent bg-[length:200%_100%] animate-gradient-x">statistically safer route</span> through {city.label}
        </h1>
        <p className="mt-2 text-slate2-700 max-w-2xl">
          Type a starting point and a destination — both can be neighborhoods, ZIP codes, or major landmarks. We pull up to three route alternatives from OpenStreetMap&apos;s routing engine, score each by the recent crime exposure of the neighborhoods it crosses (using the same official police feed that powers the Crime Map), and rank them safest first.
        </p>
      </header>

      <CityBanner />

      <section className="surface p-5 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-slate2-700">From</span>
            <input
              value={fromQ}
              onChange={(e) => setFromQ(e.target.value)}
              placeholder={`e.g. Hillcrest, ${city.label}`}
              className="mt-1 input"
              autoComplete="off"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate2-700">To</span>
            <input
              value={toQ}
              onChange={(e) => setToQ(e.target.value)}
              placeholder={`e.g. Pacific Beach, ${city.label}`}
              className="mt-1 input"
              autoComplete="off"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-baseline gap-2 mt-1">
          <span className="text-xs uppercase tracking-wider text-slate2-500 mr-1">Mode:</span>
          {MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              title={m.hint}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                mode === m.value ? "bg-bay-500 text-white" : "text-slate2-700 hover:bg-bay-50"
              }`}
            >
              {m.label}
            </button>
          ))}
          <button
            onClick={compute}
            disabled={busy || !fromQ.trim() || !toQ.trim()}
            className="ml-auto btn-primary text-sm px-4 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? "Routing…" : "Find safe routes"}
          </button>
        </div>
        {error && <p className="text-xs text-coral-700 mt-1">{error}</p>}
      </section>

      {result && (
        <>
          <RouteMap
            from={result.from}
            to={result.to}
            routes={result.routes}
            selectedIdx={selectedIdx}
            ratingStrokes={RATING_TONE}
          />

          <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {result.routes.map((r, i) => {
              const tone = RATING_TONE[r.rating];
              const min = Math.round(r.durationSec / 60);
              const km = (r.distanceMeters / 1000).toFixed(1);
              const selected = i === selectedIdx;
              return (
                <button
                  key={i}
                  onClick={() => setSelectedIdx(i)}
                  className={`surface p-4 text-left transition-all ${selected ? "ring-2 ring-bay-400 shadow-card-lift" : "hover:shadow-card"}`}
                >
                  <header className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-white font-display"
                        style={{ background: tone.stroke }}
                      >
                        {r.rating}
                      </span>
                      <span className={`text-xs font-medium ${tone.tone}`}>{tone.label}</span>
                    </div>
                    <span className="text-xs text-slate2-500 tabular-nums">{km} km · {min} min</span>
                  </header>
                  <p className="mt-2 text-sm text-slate2-700 leading-snug">{r.headline}</p>
                  <p className="mt-2 text-xs text-slate2-500 tabular-nums">
                    Exposure score: {r.exposureScore.toLocaleString()} · {r.exposurePer100k.toLocaleString()} per 100k m
                  </p>
                </button>
              );
            })}
          </section>

          <p className="surface-muted p-3 text-xs text-slate2-700 leading-snug">
            {result.disclaimer}{" "}
            <a href={result.source.url} target="_blank" rel="noreferrer" className="text-bay-700 hover:underline">
              {result.source.label}
            </a>
          </p>
        </>
      )}
    </main>
  );
}
