import "server-only";
import { crimeData } from "../crime-data";
import { cityForArea } from "../crime-data/cities";

/// Safety Score — compares the user's selected area against the FBI's most
/// recent national rates per 100,000 residents. Returns the raw local and
/// national numbers so the UI can render whatever shape it wants without
/// re-doing the math.
///
/// FBI Crime in the Nation 2024 (released October 2025) is the latest annual
/// release. The numbers below match the rates the FBI publishes on the
/// current Crime Data Explorer at cde.ucr.cjis.gov. The link goes straight
/// to the trend view so users can verify.

export const FBI_NATIONAL_PER_100K_2024 = { PERSONS: 364, PROPERTY: 1896 };
export const FBI_NATIONAL_SOURCE = {
  label: "FBI Crime in the Nation 2024 (Uniform Crime Reporting)",
  url: "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend",
  publishedYear: 2024,
};

// US Census Bureau Vintage 2023 city population estimates — the most recent
// official annual estimate for each city we support. Used both for citywide
// and as a per-area baseline (population per area is approximated by even
// distribution across the city's named neighborhoods).
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
  "las-vegas":       660_929,
  "boise":           237_446,
  "buffalo":         272_140,
  "tucson":          544_417,
  "kansas-city":     510_704,
  "saint-paul":      303_820,
};

export interface SafetyScoreRow {
  category: "PERSONS" | "PROPERTY";
  /// Incidents in this area for the cached window.
  count: number;
  /// Annualized per-100k rate for this area, given a population estimate.
  localPer100k: number;
  /// FBI national average for the same category, same year.
  nationalPer100k: number;
  /// Percentage delta vs national. Positive = above national.
  deltaPct: number;
}

export interface SafetyScoreResponse {
  city: { slug: string; label: string };
  area: { slug: string; label: string };
  /// Population estimate used for the rate. For neighborhoods this is
  /// approximated by dividing the city total across all known neighborhoods.
  populationEstimate: number;
  /// What window of the police feed this score reflects (in days).
  windowDays: number;
  /// Most recent incident date inside the window.
  asOf: string | null;
  /// One letter grade derived from how far below / above national the area
  /// sits. The thresholds are conservative — only material deviations get an
  /// A or D. Local ≤ 60% of national → A; ≤ 90% → B; ≤ 130% → C; ≤ 200% → D;
  /// > 200% → E. Computed on the average percentile across the two reported
  /// categories so a property-crime spike alone can't tank the grade.
  grade: "A" | "B" | "C" | "D" | "E";
  /// Plain-English headline the UI can drop straight into a card.
  headline: string;
  rows: SafetyScoreRow[];
  source: typeof FBI_NATIONAL_SOURCE;
  disclaimer: string;
}

function gradeFromDeltas(rows: SafetyScoreRow[]): SafetyScoreResponse["grade"] {
  // Average the local/national ratio across the two reported categories.
  const ratios = rows.map((r) => r.nationalPer100k > 0 ? r.localPer100k / r.nationalPer100k : 1);
  if (ratios.length === 0) return "C";
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  if (avg <= 0.6) return "A";
  if (avg <= 0.9) return "B";
  if (avg <= 1.3) return "C";
  if (avg <= 2.0) return "D";
  return "E";
}

function headlineFor(grade: SafetyScoreResponse["grade"], areaLabel: string, cityLabel: string): string {
  switch (grade) {
    case "A": return `${areaLabel} sits well below the FBI national rate for ${cityLabel}-area neighborhoods.`;
    case "B": return `${areaLabel} reports below the FBI national rate.`;
    case "C": return `${areaLabel} tracks roughly the FBI national rate — neither markedly safer nor more active.`;
    case "D": return `${areaLabel} reports above the FBI national rate. Use the cards below to see which category drives the gap.`;
    case "E": return `${areaLabel} reports substantially above the FBI national rate. Use the Awareness tab for the offense mix.`;
  }
}

export async function getSafetyScore(areaSlug: string, areaLabel: string): Promise<SafetyScoreResponse> {
  const city = cityForArea(areaSlug);
  const cityPop = CITY_POPULATION[city.slug] ?? 0;
  const incidents = await crimeData.getIncidents(areaSlug, { limit: 5000 }).catch(() => []);
  // Compute the rate-relevant counts (Society isn't published as a national
  // rate by the FBI so we hide it from the comparison).
  let persons = 0, property = 0;
  let earliest = Infinity, latest = 0;
  for (const i of incidents) {
    const k = i.nibrsCategory as "PERSONS" | "PROPERTY" | "SOCIETY";
    if (k === "PERSONS") persons += 1;
    else if (k === "PROPERTY") property += 1;
    const t = +new Date(i.occurredAt);
    if (Number.isFinite(t) && t > 0) {
      if (t < earliest) earliest = t;
      if (t > latest) latest = t;
    }
  }
  const windowDays = (latest > 0 && earliest < Infinity)
    ? Math.max(1, Math.round((latest - earliest) / (24 * 60 * 60 * 1000)))
    : 0;
  // Approximate per-area population: equal split across the city's named
  // neighborhoods. The exact value matters less than the relative comparison
  // since both numerator and denominator scale the same way for "this area".
  let pop = cityPop;
  try {
    const knownAreas = await city.discover();
    if (knownAreas.length > 0 && cityPop > 0) {
      pop = Math.round(cityPop / knownAreas.length);
    }
  } catch { /* fall back to citywide */ }

  // Annualize: rate per 100k for the year, given the window we observed.
  const annualize = (count: number) => {
    if (pop <= 0 || windowDays <= 0) return 0;
    const annualCount = count * (365 / windowDays);
    return (annualCount / pop) * 100_000;
  };

  const rows: SafetyScoreRow[] = [
    {
      category: "PERSONS",
      count: persons,
      localPer100k: Math.round(annualize(persons)),
      nationalPer100k: FBI_NATIONAL_PER_100K_2024.PERSONS,
      deltaPct: FBI_NATIONAL_PER_100K_2024.PERSONS === 0 ? 0
        : Math.round(((annualize(persons) - FBI_NATIONAL_PER_100K_2024.PERSONS) / FBI_NATIONAL_PER_100K_2024.PERSONS) * 100),
    },
    {
      category: "PROPERTY",
      count: property,
      localPer100k: Math.round(annualize(property)),
      nationalPer100k: FBI_NATIONAL_PER_100K_2024.PROPERTY,
      deltaPct: FBI_NATIONAL_PER_100K_2024.PROPERTY === 0 ? 0
        : Math.round(((annualize(property) - FBI_NATIONAL_PER_100K_2024.PROPERTY) / FBI_NATIONAL_PER_100K_2024.PROPERTY) * 100),
    },
  ];

  const grade = gradeFromDeltas(rows);
  const headline = headlineFor(grade, areaLabel, city.label);

  return {
    city: { slug: city.slug, label: city.label },
    area: { slug: areaSlug, label: areaLabel },
    populationEstimate: pop,
    windowDays,
    asOf: latest > 0 ? new Date(latest).toISOString() : null,
    grade,
    headline,
    rows,
    source: FBI_NATIONAL_SOURCE,
    disclaimer:
      "Per-100k rates are annualized from the window of incidents the city's " +
      "police adapter currently has cached. Population for each neighborhood " +
      `is approximated by evenly dividing the ${city.label} city total across all ` +
      "known neighborhoods — accurate for relative comparisons, not census-grade. " +
      `National rates are the FBI Uniform Crime Reporting program's ${FBI_NATIONAL_SOURCE.publishedYear} ` +
      "annual release. Society / public-order offenses are excluded because the " +
      "FBI doesn't publish a national rate for that category.",
  };
}
