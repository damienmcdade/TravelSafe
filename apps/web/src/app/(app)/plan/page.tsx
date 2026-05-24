"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import SafetyScorePage from "../safety-score/page";
import SafeRoutePage from "../route/page";

type PlanTab = "score" | "route";

const TABS: Array<{ id: PlanTab; label: string; sublabel: string }> = [
  { id: "score", label: "Safety Score",  sublabel: "Grade + trend + neighborhood compare" },
  { id: "route", label: "Safe Route",    sublabel: "Plan a walk or drive across the city" },
];

/// `/plan` — Investigate workflow hub. Hosts Safety Score (with the
/// inline Trend Feed and Compare overlay it already renders) and
/// Safe Route as side-by-side sub-tabs. Both sub-pages stay mounted
/// across tab switches so internal state (compare picks, route
/// results, picker state) survives a tab toggle — the previous
/// stand-alone /safety-score and /route URLs still work and now
/// route through here.
function PlanInner() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = (params?.get("tab") as PlanTab) === "route" ? "route" : "score";
  const [tab, setTab] = useState<PlanTab>(initial);

  // Push the tab into the URL so deep links / refreshes preserve it,
  // and so old /route bookmarks redirected here (?tab=route) land on
  // the right pane.
  useEffect(() => {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (tab === "score") next.delete("tab");
    else next.set("tab", tab);
    const qs = next.toString();
    router.replace(qs ? `/plan?${qs}` : "/plan", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Plan workflow" className="surface-muted px-3 py-2 flex flex-wrap gap-1 text-sm">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`plan-panel-${t.id}`}
            id={`plan-tab-${t.id}`}
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

      {/* Both panels stay MOUNTED across tab switches via the `hidden`
          attribute — same pattern the legacy /threats Awareness toggle
          uses to preserve in-page state. The two sub-pages run their
          own hooks; SWR cache reuse makes the second mount near-free. */}
      <div hidden={tab !== "score"} id="plan-panel-score" role="tabpanel" aria-labelledby="plan-tab-score">
        <SafetyScorePage />
      </div>
      <div hidden={tab !== "route"} id="plan-panel-route" role="tabpanel" aria-labelledby="plan-tab-route">
        <SafeRoutePage />
      </div>
    </div>
  );
}

export default function PlanPage() {
  // useSearchParams must be wrapped in Suspense in App Router pages.
  return (
    <Suspense fallback={<div className="surface p-6 text-sm text-slate2-500 animate-pulse">Loading plan…</div>}>
      <PlanInner />
    </Suspense>
  );
}
