"use client";
import { relativeTime } from "@/lib/sse";
import { displayOffenseLabel } from "@/lib/offense-labels";

export interface IncidentCardItem {
  id: string;
  area: string;
  occurredAt: string;
  nibrsCategory: "PERSONS" | "PROPERTY" | "SOCIETY";
  ibrOffenseDescription: string;
  beat?: string | null;
  blockLabel?: string;
}

const TONE: Record<IncidentCardItem["nibrsCategory"], {
  border: string; chip: string; iconBg: string; iconColor: string; label: string; gradient: string;
}> = {
  PERSONS:  { border: "border-l-bay-500",   chip: "bg-bay-200 text-bay-700",     iconBg: "bg-bay-100",   iconColor: "text-bay-700",   label: "Persons",  gradient: "from-bay-50 to-white" },
  PROPERTY: { border: "border-l-coral-500", chip: "bg-coral-200 text-coral-700", iconBg: "bg-coral-200", iconColor: "text-coral-700", label: "Property", gradient: "from-coral-200/40 to-white" },
  SOCIETY:  { border: "border-l-sage-500",  chip: "bg-sage-200 text-sage-700",   iconBg: "bg-sage-200",  iconColor: "text-sage-700",  label: "Society",  gradient: "from-sage-200/40 to-white" },
};

function CategoryIcon({ kind, className = "w-4 h-4" }: { kind: IncidentCardItem["nibrsCategory"]; className?: string }) {
  if (kind === "PERSONS") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
        <circle cx={12} cy={8} r={3.5} /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    );
  }
  if (kind === "PROPERTY") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M3 10l9-7 9 7" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 12h18" /><circle cx={12} cy={12} r={9} /><path d="M12 3a14 14 0 0 1 0 18" /><path d="M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

export function IncidentCard({ incident }: { incident: IncidentCardItem }) {
  const t = TONE[incident.nibrsCategory];
  const when = relativeTime(incident.occurredAt);
  return (
    <article className={`surface p-4 border-l-4 ${t.border} bg-gradient-to-br ${t.gradient} animate-rise-in`}>
      <header className="flex items-start gap-3">
        <span className={`inline-flex items-center justify-center w-9 h-9 rounded-xl shrink-0 ${t.iconBg} ${t.iconColor}`}>
          <CategoryIcon kind={incident.nibrsCategory} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-slate2-900 font-medium leading-snug">{displayOffenseLabel(incident.ibrOffenseDescription)}</h3>
            <span className={`text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${t.chip}`}>{t.label}</span>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate2-500">
            <div><dt className="inline text-slate2-700">When · </dt><dd className="inline">{when}</dd></div>
            <div><dt className="inline text-slate2-700">Area · </dt><dd className="inline">{incident.area}</dd></div>
            {incident.beat && (
              <div>
                {/* v67 followup — "beat" is police-precinct jargon.
                    Tooltip explains it for non-law-enforcement readers
                    without enlarging the label or adding visual noise. */}
                <dt
                  className="inline text-slate2-700"
                  title="Police beat — the patrol-area subdivision the responding officer was assigned to."
                >
                  Beat ·{" "}
                </dt>
                <dd className="inline">{incident.beat}</dd>
              </div>
            )}
            {incident.blockLabel && <div className="col-span-2 truncate"><dt className="inline text-slate2-700">Block · </dt><dd className="inline">{incident.blockLabel}</dd></div>}
          </dl>
        </div>
      </header>
    </article>
  );
}
