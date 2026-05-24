"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import SafetyPage from "../safety/page";
import CommunityPage from "../community/page";

type ActTab = "tools" | "community";

const TABS: Array<{ id: ActTab; label: string; sublabel: string }> = [
  { id: "tools",     label: "Personal Safety", sublabel: "Emergency, check-in, location sharing" },
  { id: "community", label: "CommunitySafe",   sublabel: "Neighbor reports + community signals" },
];

/// `/act` — Act workflow hub. Hosts the Personal Safety tools and the
/// CommunitySafe feed as sub-tabs. Both are user-action surfaces (the
/// user is *doing* something rather than browsing or investigating)
/// so they share a hub. Old /safety and /community URLs still work
/// and now route through here.
function ActInner() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = (params?.get("tab") as ActTab) === "community" ? "community" : "tools";
  const [tab, setTab] = useState<ActTab>(initial);

  useEffect(() => {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (tab === "tools") next.delete("tab");
    else next.set("tab", tab);
    const qs = next.toString();
    router.replace(qs ? `/act?${qs}` : "/act", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Act workflow" className="surface-muted px-3 py-2 flex flex-wrap gap-1 text-sm">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`act-panel-${t.id}`}
            id={`act-tab-${t.id}`}
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

      <div hidden={tab !== "tools"} id="act-panel-tools" role="tabpanel" aria-labelledby="act-tab-tools">
        <SafetyPage />
      </div>
      <div hidden={tab !== "community"} id="act-panel-community" role="tabpanel" aria-labelledby="act-tab-community">
        <CommunityPage />
      </div>
    </div>
  );
}

export default function ActPage() {
  return (
    <Suspense fallback={<div className="surface p-6 text-sm text-slate2-500 animate-pulse">Loading act…</div>}>
      <ActInner />
    </Suspense>
  );
}
