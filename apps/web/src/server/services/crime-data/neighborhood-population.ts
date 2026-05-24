import { GENERATED_NEIGHBORHOOD_POPS } from "./neighborhood-populations-generated";

// Per-neighborhood population resolution. The hierarchy:
//
//   1. Manual override in this file (POP map below). Used to correct
//      individual neighborhoods where the generated estimate is
//      obviously off OR where local sources (SANDAG, DCP) publish
//      better numbers than ACS tract aggregation.
//   2. Generated table from tools/build-neighborhood-populations.mjs
//      (ACS 5-year via Census Reporter + TigerWeb spatial join).
//      Covers every polygon we have boundary data for.
//   3. Fall through (caller uses the polygon-area / peer-share
//      heuristics).
//
// Manual overrides exist when the ACS spatial join produces a
// number that's clearly wrong for a specific neighborhood. Each
// entry MUST cite its source so future maintainers can reconcile.
//
// Sources, in order of preference:
//   1. ACS 5-year estimates (data.census.gov) — the federal standard
//      the FBI itself uses for the national per-100k rate this app
//      compares against. Where possible we use the most-recent
//      tract-aggregated number that lines up with the neighborhood
//      polygon.
//   2. SANDAG (San Diego), DCP (NYC), Chicago Data Portal etc. —
//      regional planning agency estimates published alongside
//      neighborhood boundaries. These are typically derived from
//      ACS but with the agency's own neighborhood definitions.
//   3. City planning department reports — usually annual, less
//      frequent than ACS but still authoritative for the local
//      definition of "neighborhood".
//
// Each entry MUST cite its source so future maintainers can refresh
// the numbers when the next ACS release lands. Pull the citation
// year from the source URL (ACS 2018-2022 → "ACS 2022", etc.).
//
// Coverage policy: prioritize the neighborhoods users actually visit
// most often. The polygon + peer-share fallback still handles the
// long tail correctly enough that hand-curating every neighborhood
// in every city isn't worth the maintenance burden.

interface NeighborhoodPopEntry {
  population: number;
  source: string;
}

const POP: Record<string, Record<string, NeighborhoodPopEntry>> = {
  "san-diego": {
    // SANDAG Community Profiles (sandag.org) keyed by the same
    // SDPD neighborhood names this app discovers. Source year
    // reflects the most-recent published profile per neighborhood.
    "downtown":           { population: 36_092, source: "SANDAG 2023" },
    "pacific-beach":      { population: 41_956, source: "SANDAG 2023" },
    "gaslamp":            { population:  5_300, source: "SANDAG 2023 (Downtown sub-area)" },
    "hillcrest":          { population: 18_500, source: "SANDAG 2023 (Uptown sub-area)" },
    "north-park":         { population: 51_226, source: "SANDAG 2023" },
    "ocean-beach":        { population: 14_456, source: "SANDAG 2023" },
    "la-jolla":           { population: 46_781, source: "SANDAG 2023" },
    "mission-valley":     { population: 25_000, source: "SANDAG 2023" },
    "college-area":       { population: 49_385, source: "SANDAG 2023" },
    "mira-mesa":          { population: 81_283, source: "SANDAG 2023" },
    "rancho-bernardo":    { population: 47_722, source: "SANDAG 2023" },
    "kearny-mesa":        { population: 12_500, source: "SANDAG 2023" },
    "linda-vista":        { population: 39_000, source: "SANDAG 2023" },
    "clairemont":         { population: 78_500, source: "SANDAG 2023 (Clairemont Mesa)" },
    "encanto":            { population: 24_750, source: "SANDAG 2023 (Encanto Neighborhoods)" },
    "midway-pacific-highway": { population: 9_500, source: "SANDAG 2023 (Midway-Pacific Hwy)" },
    "core-columbia":      { population: 36_092, source: "SANDAG 2023 (legacy slug for Downtown)" },
  },
  // Other cities: populate as user traffic warrants. Polygon + peer-
  // share remain the fallback so safety-score continues to work for
  // every neighborhood the adapters discover.
};

/// Returns a population for the given (city, area) pair, preferring
/// the manual curated table over the auto-generated ACS table. Falls
/// through to null when neither has an entry; callers then use the
/// polygon-area / peer-share heuristics with the density-bias floor.
export function knownNeighborhoodPopulation(
  citySlug: string,
  areaSlug: string,
): { population: number; source: string } | null {
  // 1. Manual override wins. Used to correct individual neighborhoods
  //    where ACS aggregation produces a clearly-wrong number.
  const manual = POP[citySlug]?.[areaSlug];
  if (manual) return manual;
  // 2. Generated ACS table. Covers every polygon we have boundaries
  //    for across the 28 cities currently in the pipeline output.
  const generated = GENERATED_NEIGHBORHOOD_POPS[citySlug]?.[areaSlug];
  if (Number.isFinite(generated) && generated > 0) {
    return { population: generated, source: "Census ACS 5-year (latest) via Census Reporter — tract centroid ∈ polygon spatial join" };
  }
  return null;
}
