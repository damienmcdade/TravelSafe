"use client";
import { useEffect, useRef, useState } from "react";
import { api, useApi } from "@/lib/api-client";

interface Area { slug: string; label: string; jurisdiction: string }
interface LookupResult { area: Area; matchedVia: "exact" | "zip" | "fuzzy" | "geocode"; rawQuery: string }

export function LocationSearch({
  onResolved,
  current,
  placeholder = "Search neighborhood, ZIP, or address (e.g. La Jolla, 92109, Garnet Ave)",
}: {
  onResolved: (area: Area | null) => void;
  current?: Area | null;
  placeholder?: string;
}) {
  const { data: areas } = useApi<Area[]>("/geo/areas");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"idle" | "looking" | "found" | "miss" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  async function lookup(query: string) {
    setStatus("looking");
    setError(null);
    try {
      const r = await api<LookupResult>(`/geo/lookup?q=${encodeURIComponent(query)}`);
      onResolved(r.area);
      setStatus("found");
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 404) {
        setStatus("miss");
        setError(`Couldn't match "${query}" to a known SD neighborhood. Try a ZIP code or a major area name.`);
      } else {
        setStatus("error");
        setError(err.message);
      }
    }
  }

  function onChange(v: string) {
    setQ(v);
    if (timer.current) window.clearTimeout(timer.current);
    if (v.trim().length < 2) {
      setStatus("idle");
      return;
    }
    timer.current = window.setTimeout(() => void lookup(v), 450);
  }

  function pickKnown(area: Area) {
    setQ(area.label);
    setStatus("found");
    onResolved(area);
  }

  function clear() {
    setQ("");
    setStatus("idle");
    setError(null);
    onResolved(null);
  }

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  return (
    <div className="surface p-4">
      <label className="text-sm text-slate2-700">Show me</label>
      <div className="mt-1 flex gap-2">
        <input
          value={q}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 input"
        />
        {current && (
          <button onClick={clear} className="btn-ghost text-xs">
            ← Citywide
          </button>
        )}
      </div>
      <div className="mt-2 text-xs h-4">
        {status === "looking" && <span className="text-slate2-500 animate-pulse">Looking up…</span>}
        {status === "found"   && current && <span className="text-sage-700">→ {current.label}</span>}
        {status === "miss"    && <span className="text-amber2-700">{error}</span>}
        {status === "error"   && <span className="text-dusk-700">{error}</span>}
      </div>
      {(areas?.length ?? 0) > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="text-xs text-slate2-500 mr-1 self-center">Quick pick:</span>
          {(areas ?? []).slice(0, 8).map((a) => (
            <button
              key={a.slug}
              onClick={() => pickKnown(a)}
              className="text-xs px-2.5 py-1 rounded-full bg-sand-100 hover:bg-bay-200 hover:text-bay-700 text-slate2-700 transition-all duration-200 ease-spring hover:-translate-y-0.5"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
