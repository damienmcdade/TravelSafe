"use client";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";

// FBI Crime in the Nation 2023 — most recently published national estimated
// rates per 100,000 people (released by the FBI in late 2024 alongside the
// 2023 Crime in the Nation report). NIBRS has three groups but the FBI's
// published national rates cover only Violent (≈ Persons) and Property crime,
// so we hide Society.
// Source: https://crime-data-explorer.fr.cloud.gov/pages/explorer/crime/crime-trend
const NATIONAL_PER_100K = { PERSONS: 364, PROPERTY: 1896 };
const NATIONAL_YEAR = 2023;
const NATIONAL_SOURCE_URL = "https://crime-data-explorer.fr.cloud.gov/pages/explorer/crime/crime-trend";

// US Census Bureau Vintage 2023 Population Estimates (released April 2024) —
// the most recent official population estimates available for these cities.
// Source: https://www.census.gov/programs-surveys/popest.html
// US Census Bureau Vintage 2023 Population Estimates (released April 2024).
const CITY_POPULATION: Record<string, number> = {
  "san-diego":     1_381_611,
  "los-angeles":   3_820_914,
  "san-francisco":   808_988,
  "chicago":       2_664_452,
  "seattle":         755_078,
  "new-york":      8_258_035,
  "denver":          716_577,
  "detroit":         633_218,
  "washington-dc":   678_972,
  "boston":          650_706,
  "philadelphia":  1_550_542,
  "oakland":         430_553,
  "cincinnati":      311_097,
  "new-orleans":     364_136,
  "baton-rouge":     217_665,
  "cambridge":       118_488,
  "dallas":        1_302_868,
  "charlotte":       897_720,
  "nashville":       687_788,
  "minneapolis":     421_874,
  "cleveland":       362_656,
  "montgomery-county": 1_058_812,
};

interface PerArea { incidentCount: number; byCategory: { PERSONS: number; PROPERTY: number; SOCIETY: number } }
interface Citywide { city: string; perArea: PerArea[] }

export function NationalAverageCard() {
  const { city } = useCity();
  const { data: citywide, loading } = useApi<Citywide>(`/crime-data/citywide?city=${city.slug}`, [city.slug]);

  const population = CITY_POPULATION[city.slug] ?? 0;
  const totals = (citywide?.perArea ?? []).reduce(
    (acc, p) => ({ PERSONS: acc.PERSONS + p.byCategory.PERSONS, PROPERTY: acc.PROPERTY + p.byCategory.PROPERTY }),
    { PERSONS: 0, PROPERTY: 0 },
  );
  const rate = (count: number) => (population > 0 ? (count / population) * 100_000 : 0);

  const rows = [
    { key: "PERSONS",  label: "Violent (persons)", local: rate(totals.PERSONS),  national: NATIONAL_PER_100K.PERSONS },
    { key: "PROPERTY", label: "Property",          local: rate(totals.PROPERTY), national: NATIONAL_PER_100K.PROPERTY },
  ];

  return (
    <section className="surface p-5">
      <header className="flex items-baseline justify-between flex-wrap gap-2">
        <h3 className="font-display text-lg text-slate2-900">{city.label} vs. national average</h3>
        <a href={NATIONAL_SOURCE_URL} target="_blank" rel="noreferrer" className="text-xs text-bay-700 hover:underline">
          FBI Crime in the Nation, {NATIONAL_YEAR}
        </a>
      </header>
      <p className="mt-1 text-xs text-slate2-500">
        Bars compare {city.label}&apos;s recent per-100,000 rate against the FBI&apos;s national average for the same category. Longer bar = more incidents per resident.
      </p>

      {loading ? (
        <div className="mt-4 space-y-5">
          {[0, 1].map((i) => (<div key={i} className="space-y-2"><div className="skel h-3 w-1/2" /><div className="skel h-5 w-full" /><div className="skel h-5 w-full" /></div>))}
        </div>
      ) : (
        <div className="mt-5 space-y-6">
          {rows.map((r) => (
            <CompareRow key={r.key} label={r.label} cityLabel={city.label} local={r.local} national={r.national} />
          ))}
        </div>
      )}

      <Legend />
    </section>
  );
}

function CompareRow({ label, cityLabel, local, national }: { label: string; cityLabel: string; local: number; national: number }) {
  const max = Math.max(local, national) * 1.15 || 1;
  const localPct = (local / max) * 100;
  const nationalPct = (national / max) * 100;
  const delta = national === 0 ? null : ((local - national) / national) * 100;
  const worse = delta != null && delta > 5;
  const better = delta != null && delta < -5;
  const cityBarClass = worse ? "fill-coral-500" : better ? "fill-sage-500" : "fill-bay-500";
  const deltaTone = worse ? "text-coral-700" : better ? "text-sage-700" : "text-slate2-500";

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-slate2-900">{label}</span>
        <span className={`text-xs font-medium ${deltaTone}`}>
          {delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(0)}% vs national`}
        </span>
      </div>
      <svg viewBox="0 0 200 56" className="mt-2 w-full h-14" role="img" aria-label={`${label}: ${cityLabel} ${local.toFixed(0)} per 100k, national ${national.toFixed(0)} per 100k`}>
        <text x="0" y="11" className="fill-slate2-700" style={{ fontSize: 6 }}>{cityLabel}</text>
        <rect x="0"  y="14" width="200" height="8" rx="2" className="fill-sand-100" />
        <rect x="0"  y="14" width={(localPct * 200) / 100} height="8" rx="2" className={cityBarClass} />
        <text x="200" y="11" textAnchor="end" className="fill-slate2-700" style={{ fontSize: 6 }}>{local.toFixed(0)} / 100k</text>

        <text x="0" y="38" className="fill-slate2-700" style={{ fontSize: 6 }}>National avg</text>
        <rect x="0"  y="41" width="200" height="8" rx="2" className="fill-sand-100" />
        <rect x="0"  y="41" width={(nationalPct * 200) / 100} height="8" rx="2" className="fill-slate2-400" />
        <text x="200" y="38" textAnchor="end" className="fill-slate2-700" style={{ fontSize: 6 }}>{national.toLocaleString()} / 100k</text>
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
      <span className="ml-auto italic">Rolling window — directional, not a calendar-year rate.</span>
    </div>
  );
}
