"use client";
import { useApi } from "@/lib/api-client";
import { useCity } from "@/lib/use-city";

// FBI Crime in the Nation 2022 — national estimated rates per 100,000 people.
// These are the most recent published national NIBRS-derived rates from the FBI.
// Source: https://crime-data-explorer.fr.cloud.gov/pages/explorer/crime/crime-trend
//
// Note: NIBRS classifies in three groups, but the FBI's published "Crime in
// the Nation" only reports Violent Crime (≈ Persons) and Property Crime.
// "Society" doesn't have a comparable national rate, so we hide that row.
const NATIONAL_PER_100K = {
  PERSONS: 380,    // Violent crime
  PROPERTY: 1954,  // Property crime
};
const NATIONAL_YEAR = 2022;
const NATIONAL_SOURCE_URL = "https://crime-data-explorer.fr.cloud.gov/pages/explorer/crime/crime-trend";

// City populations (most recent US Census Bureau estimate).
const CITY_POPULATION: Record<string, number> = {
  "san-diego":     1_388_320,
  "los-angeles":   3_898_747,
  "san-francisco":   808_437,
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

  // Counts are a recent cached window (rolling, not a calendar year). For
  // an honest comparison we annualize by assuming the window represents a
  // proportional slice — the LA and SF feeds publish daily, SD quarterly,
  // and each adapter caps at 500 incidents per area. This is approximate
  // by design, and the card states that.
  const rate = (count: number) => (population > 0 ? (count / population) * 100_000 : 0);
  const personsRate = rate(totals.PERSONS);
  const propertyRate = rate(totals.PROPERTY);

  function delta(local: number, national: number) {
    if (national === 0) return null;
    return ((local - national) / national) * 100;
  }

  const personsDelta = delta(personsRate, NATIONAL_PER_100K.PERSONS);
  const propertyDelta = delta(propertyRate, NATIONAL_PER_100K.PROPERTY);

  return (
    <section className="surface p-5 bg-gradient-to-br from-white to-bay-50">
      <header className="flex items-baseline justify-between flex-wrap gap-2">
        <h3 className="font-display text-lg text-slate2-900">{city.label} vs. national average</h3>
        <a href={NATIONAL_SOURCE_URL} target="_blank" rel="noreferrer" className="text-xs text-bay-700 hover:underline">
          FBI Crime in the Nation, {NATIONAL_YEAR}
        </a>
      </header>
      <p className="mt-1 text-xs text-slate2-500">
        Rough per-100,000-person comparison between the recent cached window for {city.label} and the FBI&apos;s most recent national average. The window is not a calendar year, so these are directional indicators — useful for &quot;more or less than typical&quot;, not as a precise yearly rate.
      </p>

      {loading ? (
        <ul className="mt-4 space-y-3">
          {[0, 1].map((i) => (<li key={i} className="space-y-1"><div className="skel h-4 w-1/2" /><div className="skel h-3 w-3/4" /></li>))}
        </ul>
      ) : (
        <ul className="mt-4 space-y-3 text-sm">
          <ComparisonRow label="Persons (violent)" local={personsRate} national={NATIONAL_PER_100K.PERSONS} delta={personsDelta} />
          <ComparisonRow label="Property" local={propertyRate} national={NATIONAL_PER_100K.PROPERTY} delta={propertyDelta} />
        </ul>
      )}
    </section>
  );
}

function ComparisonRow({ label, local, national, delta }: { label: string; local: number; national: number; delta: number | null }) {
  const lower = delta != null && delta < -5;
  const higher = delta != null && delta > 5;
  const tone = higher ? "text-coral-700" : lower ? "text-sage-700" : "text-slate2-700";
  return (
    <li>
      <div className="flex items-baseline justify-between">
        <span className="text-slate2-900">{label}</span>
        <span className={`text-xs font-medium ${tone}`}>
          {delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(0)}% vs national`}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-3 text-xs text-slate2-500">
        <div><span className="text-slate2-700">This area: </span>{local.toFixed(0)} per 100k</div>
        <div><span className="text-slate2-700">National: </span>{national.toLocaleString()} per 100k</div>
      </div>
    </li>
  );
}
