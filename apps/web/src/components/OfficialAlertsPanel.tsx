"use client";
import { useApi } from "@/lib/api-client";

interface OfficialAlert {
  id: string;
  source: string;
  category: string;
  severity: "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
  headline: string;
  description: string;
  effective: string;
  expires: string | null;
  url: string;
}

interface Resp { sources: string[]; alerts: OfficialAlert[]; disclaimer: string }

const SEVERITY_CLASS: Record<OfficialAlert["severity"], string> = {
  Extreme:  "bg-dusk-500/15 text-dusk-700",
  Severe:   "bg-amber2-200 text-amber2-700",
  Moderate: "bg-sand-200 text-sand-700",
  Minor:    "bg-sage-200 text-sage-700",
  Unknown:  "bg-sand-100 text-slate2-700",
};

export function OfficialAlertsPanel() {
  const { data } = useApi<Resp>("/official-alerts");
  const alerts = data?.alerts ?? [];

  return (
    <section className="surface p-6">
      <header className="flex items-center justify-between">
        <h2 className="font-display text-lg text-slate2-900">From official sources</h2>
        <span className="text-xs text-slate2-500">{(data?.sources ?? ["—"]).join(", ")}</span>
      </header>
      <p className="mt-1 text-xs text-slate2-500">
        {data?.disclaimer ?? "Independent of TravelSafe community posts."}
      </p>
      <ul className="mt-4 space-y-3">
        {alerts.length === 0 && (
          <li className="text-sm text-slate2-500 surface-muted p-3">
            No active official alerts right now. Quiet is good news.
          </li>
        )}
        {alerts.slice(0, 6).map((a) => (
          <li key={a.id} className="surface-muted p-3">
            <div className="flex items-center justify-between gap-3">
              <a href={a.url} target="_blank" rel="noreferrer" className="text-slate2-900 text-sm font-medium hover:underline">
                {a.headline}
              </a>
              <span className={`text-xs px-2 py-0.5 rounded-full ${SEVERITY_CLASS[a.severity]}`}>{a.severity}</span>
            </div>
            <div className="text-xs text-slate2-500 mt-1">
              {a.source} · effective {new Date(a.effective).toLocaleString()}
              {a.expires ? ` · until ${new Date(a.expires).toLocaleString()}` : ""}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
