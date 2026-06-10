"use client";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { IncidentCard, type IncidentCardItem } from "./IncidentCard";

interface Resp { area: string; reports: IncidentCardItem[] }

// Per-city, plain-language source label so the recent-incidents header is
// always honest about WHICH official feed the cards are drawn from.
const SOURCE_LABELS: Record<string, string> = {
  "san-diego":     "San Diego Police · refreshed every 5 min",
  "los-angeles":   "Los Angeles Police · refreshed every 5 min",
  "san-francisco": "San Francisco Police · refreshed every 5 min",
  "chicago":       "Chicago Police · refreshed every 5 min",
  "seattle":       "Seattle Police · refreshed every 5 min",
  "new-york":      "New York Police · refreshed every 5 min",
  "colorado-springs": "Colorado Springs Police · refreshed every 5 min",
  "detroit":       "Detroit Police · refreshed every 5 min",
  "washington-dc": "DC Police · last 30 days · refreshed every 5 min",
  "boston":        "Boston Police · refreshed every 5 min",
  "philadelphia":  "Philadelphia Police · refreshed every 5 min",
  "oakland":       "Oakland Police · refreshed every 5 min",
  "cincinnati":    "Cincinnati Police · refreshed every 5 min",
  "new-orleans":   "New Orleans Police (911 calls) · refreshed every 5 min",
  "baton-rouge":   "Baton Rouge Police · refreshed every 5 min",
  "cambridge":     "Cambridge Police · refreshed every 5 min",
  "dallas":        "Dallas Police · refreshed every 5 min",
  "charlotte":     "Charlotte Police · refreshed every 5 min",
  "baltimore":     "Baltimore Police · refreshed every 5 min",
  "fort-worth":    "Fort Worth Police · refreshed every 5 min",
  "minneapolis":   "Minneapolis Police · refreshed every 5 min",
  "cleveland":     "Cleveland Police (911 calls) · refreshed every 5 min",
  "milwaukee":     "Milwaukee Police · refreshed daily",
  "las-vegas":     "Las Vegas Police (911 calls) · refreshed every 5 min",
  "boise":         "Boise Police (911 calls) · refreshed every 5 min",
  "buffalo":       "Buffalo Police · refreshed every 5 min",
  "kansas-city":   "Kansas City Police · refreshed every 5 min",
  "saint-paul":    "Saint Paul Police · refreshed every 5 min",
  "pittsburgh":    "Pittsburgh Police · refreshed every 5 min",
  "denver":        "Denver Police · refreshed every 5 min",
  "sacramento":    "Sacramento Police · refreshed every 5 min",
  "atlanta":       "Atlanta Police · refreshed every 5 min",
  "indianapolis":  "Indianapolis Metro Police · refreshed every 5 min",
  "honolulu":      "Honolulu Police · refreshed every 5 min",
  "long-beach":    "Long Beach Police · refreshed every 5 min",
  "phoenix":       "Phoenix Police · refreshed periodically",
  "jacksonville":  "Jacksonville Sheriff's Office · refreshed every 5 min",
  "virginia-beach": "Virginia Beach Police · refreshed every 5 min",
  "gainesville":   "Gainesville Police · refreshed every 5 min",
  "tampa":         "Tampa Police (last 365 days) · refreshed every 5 min",
  "nashville":     "Metro Nashville Police · refreshed every 5 min",
  "houston":       "Houston Police (data through 2024) · refreshed every 5 min",
  "norfolk":       "Norfolk Police · refreshed every 5 min",
  "montgomery-county":     "Montgomery County Police · refreshed every 5 min",
  "prince-georges-county": "Prince George's County Police · refreshed every 5 min",
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
