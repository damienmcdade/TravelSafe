"use client";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";
import { formatRatePer100k, formatRatePer100kProse, formatDeltaPct } from "@/lib/format";

// City-vs-national comparison card. Reads from /api/safezone/safety-score
// which is the SAME endpoint the citywide Safety Index uses. That gives
// us:
//   - properly annualized per-100k rates (raw cached-window counts get
//     scaled by 365/windowDays)
//   - 365-day window cap so massive-volume cities (NYC, Chicago) don't
//     show inflated rates
//   - CFS calibration applied for Cleveland / NOLA / Las Vegas
//   - dataConfidence flag we can surface when the upstream feed is thin
//
// Before this refactor the card did its own math (sum the cached
// window's raw counts, divide by population, compare to annual FBI
// rate) — that produced wildly wrong rates whenever the window
// wasn't ~365 days, and never applied CFS scaling.

const NATIONAL_SOURCE_URL = "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend";

interface SafetyScoreRow {
  category: "PERSONS" | "PROPERTY";
  localPer100k: number;
  nationalPer100k: number;
  deltaPct: number;
}
interface SafetyScoreResponse {
  city: { slug: string; label: string };
  rows: SafetyScoreRow[];
  source: { label: string; url: string; publishedYear: number };
  dataConfidence: "high" | "medium" | "low";
  dataConfidenceNote?: string;
}

export function NationalAverageCard() {
  const { city } = useCity();
  const { data: score, loading, error } = useApi<SafetyScoreResponse>(`/safezone/safety-score?city=${city.slug}`, [city.slug]);

  const persons = score?.rows.find((r) => r.category === "PERSONS");
  const property = score?.rows.find((r) => r.category === "PROPERTY");
  const rows = [
    persons && { key: "PERSONS",  label: "Violent (persons)", local: persons.localPer100k,  national: persons.nationalPer100k,  deltaPct: persons.deltaPct },
    property && { key: "PROPERTY", label: "Property",          local: property.localPer100k, national: property.nationalPer100k, deltaPct: property.deltaPct },
  ].filter((r): r is { key: string; label: string; local: number; national: number; deltaPct: number } => r != null);

  return (
    <section className="surface p-5">
      <header className="flex items-baseline justify-between flex-wrap gap-2">
        <h3 className="font-display text-lg text-slate2-900">{city.label} vs. national average</h3>
        <a href={NATIONAL_SOURCE_URL} target="_blank" rel="noreferrer" className="text-xs text-bay-700 hover:underline">
          FBI Crime in the Nation, {score?.source.publishedYear ?? 2025}
        </a>
      </header>
      {/* v67 followup — replaced "annualized per-100,000 rate" jargon
          with a plain-English explainer. Hovering the dotted term
          reveals the technical phrasing for users who want it. */}
      <p className="mt-1 text-xs text-slate2-500">
        Bars compare {city.label}&apos;s <span
          className="underline decoration-dotted decoration-slate2-300 cursor-help"
          title="Annualized per-100,000 rate — incidents per 100,000 residents, scaled to a one-year period from the cached data window."
        >incidents per resident</span> against the FBI&apos;s national average for the same category. Longer bar = more incidents per resident.
      </p>

      {loading ? (
        <div className="mt-4 space-y-5">
          {[0, 1].map((i) => (<div key={i} className="space-y-2"><div className="skel h-3 w-1/2" /><div className="skel h-5 w-full" /><div className="skel h-5 w-full" /></div>))}
        </div>
      ) : error ? (
        <p className="mt-4 text-sm text-dusk-700">
          Couldn&apos;t reach the {city.label} police feed to compute the comparison. Try again in a moment — the upstream feed may be warming up.
        </p>
      ) : (
        <div className="mt-5 space-y-6">
          {rows.map((r) => (
            <CompareRow key={r.key} label={r.label} cityLabel={city.label} local={r.local} national={r.national} deltaPct={r.deltaPct} />
          ))}
          {score && score.dataConfidence !== "high" && score.dataConfidenceNote && (
            <p className="text-xs text-amber2-700 border-t border-sand-200 pt-3 italic">
              Note: {score.dataConfidenceNote}
            </p>
          )}
        </div>
      )}

      <Legend />
    </section>
  );
}

function CompareRow({ label, cityLabel, local, national, deltaPct }: { label: string; cityLabel: string; local: number; national: number; deltaPct: number }) {
  const max = Math.max(local, national) * 1.15 || 1;
  const localPct = (local / max) * 100;
  const nationalPct = (national / max) * 100;
  const worse = deltaPct > 5;
  const better = deltaPct < -5;
  const cityBarClass = worse ? "fill-coral-500" : better ? "fill-sage-500" : "fill-bay-500";
  const deltaTone = worse ? "text-coral-700" : better ? "text-sage-700" : "text-slate2-500";

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-slate2-900">{label}</span>
        <span className={`text-xs font-medium ${deltaTone}`}>
          {formatDeltaPct(deltaPct)} vs national
        </span>
      </div>
      <svg viewBox="0 0 200 56" className="mt-2 w-full h-14" role="img" aria-label={`${label}: ${cityLabel} ${formatRatePer100kProse(local)}, national ${formatRatePer100kProse(national)}`}>
        <text x="0" y="11" className="fill-slate2-700" style={{ fontSize: 6 }}>{cityLabel}</text>
        <rect x="0"  y="14" width="200" height="8" rx="2" className="fill-sand-100" />
        <rect x="0"  y="14" width={(localPct * 200) / 100} height="8" rx="2" className={cityBarClass} />
        <text x="200" y="11" textAnchor="end" className="fill-slate2-700" style={{ fontSize: 6 }}>{formatRatePer100k(local)}</text>

        <text x="0" y="38" className="fill-slate2-700" style={{ fontSize: 6 }}>National avg</text>
        <rect x="0"  y="41" width="200" height="8" rx="2" className="fill-sand-100" />
        <rect x="0"  y="41" width={(nationalPct * 200) / 100} height="8" rx="2" className="fill-slate2-400" />
        <text x="200" y="38" textAnchor="end" className="fill-slate2-700" style={{ fontSize: 6 }}>{formatRatePer100k(national)}</text>
      </svg>
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate2-500 border-t border-sand-200 pt-3">
      <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2 rounded-sm bg-sage-500" /> below national</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2 rounded-sm bg-bay-500" /> near national</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2 rounded-sm bg-coral-500" /> above national</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2 rounded-sm bg-slate2-400" /> national reference</span>
      <span className="ml-auto italic">Annualized rate from the recent cached window.</span>
    </div>
  );
}
