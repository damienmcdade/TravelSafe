// Single source of truth for the per-city population denominator.
// Imported by safety-score, the AI assistant tool definitions, the
// National Average card, and any UI surface that needs the vintage
// label. Keeping one map prevents the drift we saw when three copies
// existed in apps/web before this package was extracted.
//
// VINTAGE: US Census Bureau Vintage 2023 Population Estimates — the
// most recent annual estimate file with full coverage for these 45
// cities (fix(audit data-sev4): the count here had gone stale at "30"
// as cities were added; the registry integrity test now pins coverage).
// A V2024 refresh pass is tracked separately; year-over-year drift for
// these cities is typically <2%, well within the noise of the rolling-
// window sampling that produces our per-100k rates. UI and methodology
// copy must say "Vintage 2023" until the refresh ships.
//
// Source: https://www.census.gov/programs-surveys/popest.html
//
// DO NOT ADD CITIES HERE without first adding them to CITIES — every
// city in this map must have a working adapter.

// v95p13 — was "Vintage 2023" but seven cities added since v70 carry
// Vintage 2024 in their inline comments. Label widened to reflect the
// mix so the UI doesn't make a false uniformity claim. The per-entry
// comments still document each city's exact vintage. When all 37
// entries are next refreshed against a single vintage release, this
// constant collapses back to one year.
export const POPULATION_VINTAGE = "Vintage 2023-2024" as const;

export const CITY_POPULATION: Record<string, number> = {
  "san-diego":     1_381_611,
  "los-angeles":   3_820_914,
  "san-francisco":   808_988,
  "chicago":       2_664_452,
  "seattle":         755_078,
  "new-york":      8_258_035,
  "colorado-springs": 488_664,
  "phoenix":       1_608_139,  // 2020 US Census
  "jacksonville":    949_611,  // 2020 US Census
  "virginia-beach":  459_470,  // 2020 US Census
  "gainesville":     141_085,  // 2020 US Census
  "tampa":           384_959,  // 2020 US Census
  "nashville":       689_447,  // 2020 US Census — Nashville-Davidson metro govt (balance)
  "houston":         2_304_580, // 2020 US Census
  "montgomery-county":   1_062_061, // 2020 US Census — Montgomery County, MD
  "prince-georges-county": 967_201,  // 2020 US Census — Prince George's County, MD
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
  "baltimore":       565_239,
  "minneapolis":     421_874,
  "cleveland":       362_656,
  "milwaukee":       561_385,
  // las-vegas is CITY-proper (not LVMPD metro ~1.67M) — and that is CORRECT for
  // the citywide denominator: the 26 scored polygons are all City-of-Las-Vegas
  // neighborhoods, so the citywide numerator only counts incidents inside city
  // limits (metro CFS rows outside them geocode to "Unmapped" and are dropped).
  // City numerator ÷ city pop is consistent. The FBI baseline (473/100k) is a
  // metro-derived RATE, which is scope-robust and bridged by CFS calibration.
  // fix(audit lv-pop-scope): do NOT raise this to metro — that would divide a
  // city-scoped count by a metro pop and undercount the rate ~2.5×.
  "las-vegas":       660_929,
  "boise":           237_446,
  "buffalo":         272_140,
  "norfolk":         235_410,
  "kansas-city":     510_704,
  "saint-paul":      303_820,
  "pittsburgh":      303_255,
  "fort-worth":    1_008_106,
  // v90 — 5 new cities (US Census Vintage 2024 estimates).
  "sacramento":      528_706,
  "atlanta":         505_268,
  "indianapolis":    891_484,
  // v95p2 — 37th city. HPD's jurisdiction is the entire City and
  // County of Honolulu (Oahu), not just Honolulu CDP. Use County
  // population so the per-capita rate matches the FBI baseline,
  // which is also reported against HPD's full ORI jurisdiction.
  // US Census Bureau Vintage 2024.
  "honolulu":        991_346,
  // v100 — 38th city. US Census Bureau ACS 2024 1-year estimate.
  "long-beach":      450_917,
};

export function populationFor(slug: string): number | null {
  return CITY_POPULATION[slug] ?? null;
}
