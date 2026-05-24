"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import SafetyPage from "../safety/page";

type VigilanceTab = "personal";

const TABS: Array<{ id: VigilanceTab; label: string; sublabel: string }> = [
  { id: "personal", label: "Personal Safety", sublabel: "Emergency, check-in, location sharing" },
];

/// `/vigilance` — Vigilance hub. Personal Safety is the sole sub-tab
/// today; the hub structure is in place so future safety-related
/// features (e.g. trusted-contacts dashboard, route check-in history)
/// can land as additional tabs without reshuffling the IA.
function VigilanceInner() {
  const params = useSearchParams();
  const router = useRouter();
  const initial: VigilanceTab = "personal";
  const [tab, setTab] = useState<VigilanceTab>(initial);

  useEffect(() => {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (tab === "personal") next.delete("tab");
    else next.set("tab", tab);
    const qs = next.toString();
    router.replace(qs ? `/vigilance?${qs}` : "/vigilance", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Vigilance workflow" className="surface-muted px-3 py-2 flex flex-wrap gap-1 text-sm">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`vigilance-panel-${t.id}`}
            id={`vigilance-tab-${t.id}`}
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

      <div hidden={tab !== "personal"} id="vigilance-panel-personal" role="tabpanel" aria-labelledby="vigilance-tab-personal">
        <SafetyPage />
      </div>
    </div>
  );
}

export default function VigilancePage() {
  return (
    <Suspense fallback={<div className="surface p-6 text-sm text-slate2-500 animate-pulse">Loading vigilance…</div>}>
      <VigilanceInner />
    </Suspense>
  );
}
