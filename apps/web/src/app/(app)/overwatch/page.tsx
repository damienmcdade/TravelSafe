"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import MapPage from "../map/page";
import SafeRoutePage from "../route/page";

type OverwatchTab = "map" | "route";

const TABS: Array<{ id: OverwatchTab; label: string; sublabel: string }> = [
  { id: "map",   label: "Crime Map",  sublabel: "Geographic exploration of incidents" },
  { id: "route", label: "Safe Route", sublabel: "Plan a walk or drive across the city" },
];

/// `/overwatch` — hub for Crime Map + Safe Route. Both stay mounted
/// across tab switches via the `hidden` attribute so internal state
/// (map zoom, route picks, layer toggles) survives a toggle. Legacy
/// /map and /route URLs still work and now light up this tab.
function OverwatchInner() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = (params?.get("tab") as OverwatchTab) === "route" ? "route" : "map";
  const [tab, setTab] = useState<OverwatchTab>(initial);

  useEffect(() => {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (tab === "map") next.delete("tab");
    else next.set("tab", tab);
    const qs = next.toString();
    router.replace(qs ? `/overwatch?${qs}` : "/overwatch", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Pathfinder workflow" className="surface-muted px-3 py-2 flex flex-wrap gap-1 text-sm">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`overwatch-panel-${t.id}`}
            id={`overwatch-tab-${t.id}`}
            title={t.sublabel}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-md transition-colors font-medium ${
              tab === t.id ? "bg-bay-500 text-white" : "text-slate2-700 hover:bg-bay-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Conditional mount instead of hidden-attr toggle. Leaflet
          measures the container at 0×0 when mounted inside a
          display:none parent and never re-measures when the parent
          becomes visible — produced silent blank-tile rendering on
          mobile when the user landed on /overwatch?tab=route then
          switched to map. Conditional mount fixes that at the cost
          of losing pan/zoom state when toggling — acceptable for
          this hub since map ↔ route is a context switch, not an
          incremental adjustment. */}
      {tab === "map" && (
        <div id="overwatch-panel-map" role="tabpanel" aria-labelledby="overwatch-tab-map">
          <MapPage />
        </div>
      )}
      {tab === "route" && (
        <div id="overwatch-panel-route" role="tabpanel" aria-labelledby="overwatch-tab-route">
          <SafeRoutePage />
        </div>
      )}
    </div>
  );
}

export default function OverwatchPage() {
  return (
    <Suspense fallback={<div className="surface p-6 text-sm text-slate2-500 animate-pulse">Loading Pathfinder…</div>}>
      <OverwatchInner />
    </Suspense>
  );
}
