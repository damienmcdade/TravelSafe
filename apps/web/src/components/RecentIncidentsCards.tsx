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
  "colorado-springs": "CSPD Crime Level Data · refreshed every 5 min",
  "detroit":       "Detroit RMS Crime Incidents · refreshed every 5 min",
  "washington-dc": "DC MPD · last 30 days · refreshed every 5 min",
  "boston":        "BPD Crime Incident Reports · refreshed every 5 min",
  "philadelphia":  "PPD Crime Incidents Part 1 & 2 · refreshed every 5 min",
  "oakland":       "OPD CrimeWatch Reports · refreshed every 5 min",
  "cincinnati":    "CPD Crime Incidents · refreshed every 5 min",
  "new-orleans":   "NOPD Calls for Service · refreshed every 5 min",
  "baton-rouge":   "BRPD Crime Incidents · refreshed every 5 min",
  "cambridge":     "CPD Crime Reports · refreshed every 5 min",
  "dallas":        "DPD Police Incidents · refreshed every 5 min",
  "charlotte":     "CMPD Incidents · refreshed every 5 min",
  "baltimore":     "BPD NIBRS Group A Crime Data · refreshed every 5 min",
  "fort-worth":    "FWPD Crime Data · refreshed every 5 min",
  "minneapolis":   "MPD Crime_Data · refreshed every 5 min",
  "cleveland":     "CDP Calls for Service · refreshed every 5 min",
  "milwaukee":     "Milwaukee Police WIBR · refreshed daily",
  "las-vegas":     "LVMPD Calls for Service · refreshed every 5 min",
  "boise":         "BPD Calls for Service · refreshed every 5 min",
  "buffalo":       "Buffalo PD Crime Incidents · refreshed every 5 min",
  "tucson":        "TPD Incidents (Last 45 Days) · refreshed every 5 min",
  "kansas-city":   "KCPD Crime Data · refreshed every 5 min",
  "saint-paul":    "SPPD Crime Incident Report · refreshed every 5 min",
  "pittsburgh":    "PBP Monthly Criminal Activity · refreshed every 5 min",
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
        <div className="surface-muted p-6 min-h-[140px] flex items-center justify-center text-center">
          <p className="text-sm text-slate2-500 max-w-md">
            No recent reports in this area from the {city.label} police feed. That is typical for many neighborhoods in any given week — the feed only includes recently published incident reports.
          </p>
        </div>
      )}
      {!loading && reports.length > 0 && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {reports.map((r) => (<li key={r.id}><IncidentCard incident={r} /></li>))}
        </ul>
      )}
    </section>
  );
}
