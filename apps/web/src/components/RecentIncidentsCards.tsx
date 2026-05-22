"use client";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { IncidentCard, type IncidentCardItem } from "./IncidentCard";

interface Resp { area: string; reports: IncidentCardItem[] }

// Per-city, plain-language source label so the recent-incidents header is
// always honest about WHICH official feed the cards are drawn from.
const SOURCE_LABELS: Record<string, string> = {
  "san-diego":     "SDPD NIBRS · refreshed every 5 min",
  "los-angeles":   "LAPD Crime Data · refreshed every 5 min",
  "san-francisco": "SFPD Incident Reports · refreshed every 5 min",
  "chicago":       "CPD Crimes 2001-Present · refreshed every 5 min",
  "seattle":       "SPD Crime Data · refreshed every 5 min",
  "new-york":      "NYPD Complaint Data YTD · refreshed every 5 min",
};

export function RecentIncidentsCards({
  area,
  jurisdiction,
  limit = 8,
  title = "Recently reported in this area",
}: {
  area?: string;
  jurisdiction?: string;
  limit?: number;
  title?: string;
}) {
  const { city } = useCity();
  const path =
    area ? `/crime-data/recent?neighborhood=${area}&limit=${limit}`
    : jurisdiction ? `/crime-data/recent?jurisdiction=${jurisdiction}&limit=${limit}`
    : null;
  const { data, loading, error } = useApi<Resp>(path, [path]);
  const reports = data?.reports ?? [];

  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between">
        <h2 className="font-display text-xl text-slate2-900">{title}</h2>
        <span className="text-xs text-slate2-500">{SOURCE_LABELS[city.slug] ?? "Official police data"}</span>
      </header>
      {loading && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="surface p-4 space-y-2"><div className="skel h-4 w-2/3" /><div className="skel h-3 w-1/2" /></li>
          ))}
        </ul>
      )}
      {error && !loading && (
        <p className="text-sm text-dusk-700">Could not reach the {city.label} police data feed right now. Try again in a moment.</p>
      )}
      {!loading && !error && reports.length === 0 && (
        <p className="surface-muted p-4 text-sm text-slate2-500">
          No recent reports in this area from the {city.label} police feed. That is typical for many neighborhoods in any given week.
        </p>
      )}
      {!loading && reports.length > 0 && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {reports.map((r) => (<li key={r.id}><IncidentCard incident={r} /></li>))}
        </ul>
      )}
    </section>
  );
}
