// Single source of truth for the per-city population denominator.
// Imported by safety-score, the AI assistant tool definitions, the
// National Average card, and any UI surface that needs the vintage
// label. Keeping one map prevents the drift we saw when three copies
// existed in apps/web before this package was extracted.
//
// VINTAGE: US Census Bureau Vintage 2023 Population Estimates — the
// most recent annual estimate file with full coverage for these 30
// cities. A V2024 refresh pass is tracked separately; year-over-year
// drift for these cities is typically <2%, well within the noise of
// the rolling-window sampling that produces our per-100k rates. UI
// and methodology copy must say "Vintage 2023" until the refresh ships.
//
// Source: https://www.census.gov/programs-surveys/popest.html
//
// DO NOT ADD CITIES HERE without first adding them to CITIES — every
// city in this map must have a working adapter.

export const POPULATION_VINTAGE = "Vintage 2023" as const;

export const CITY_POPULATION: Record<string, number> = {
  "san-diego":     1_381_611,
  "los-angeles":   3_820_914,
  "san-francisco":   808_988,
  "chicago":       2_664_452,
  "seattle":         755_078,
  "new-york":      8_258_035,
  "colorado-springs": 488_664,
  "denver":          716_577,  // v70 — US Census Bureau Vintage 2024 estimate
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
  "milwaukee":       561_385,
  "las-vegas":       660_929,
  "boise":           237_446,
  "buffalo":         272_140,
  "norfolk":         235_410,
  "kansas-city":     510_704,
  "saint-paul":      303_820,
  "pittsburgh":      303_255,
  "phoenix":       1_650_070,
};

export function populationFor(slug: string): number | null {
  return CITY_POPULATION[slug] ?? null;
}
