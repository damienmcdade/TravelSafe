// Barrel exports for @travelsafe/crime-data.
//
// This package hosts the FULL crime-data adapter ecosystem so both
// apps/web (Vercel routes) and apps/api (Railway routes) consume the
// SAME 33 adapters + cities registry + neighborhood discovery + FBI
// baselines + population data without copy/paste drift.
//
// Previously these lived under apps/web/src/server/services/crime-data
// and apps/web/src/server/data. Phase 2 of the route-parity migration
// extracted them so Railway can host /api/safezone and /api/crime-data
// without re-implementing the adapters.

export type {
  DataProvenance,
  AreaStats,
  Incident,
  AreaRiskAlert,
  CrimeDataAdapter,
  KnownArea,
} from "./types.js";

export { CITY_POPULATION, POPULATION_VINTAGE, populationFor } from "./population.js";

export {
  quantile,
  areaCounts,
  deriveBands,
  bucketByBands,
  riskLevelFromAreaCounts,
} from "./risk-bands.js";

export {
  registerRowCache,
  evictAllRowCaches,
  registeredRowCacheCount,
} from "./cache-registry.js";

export type { CityFbiBaseline } from "./fbi-baselines.js";
export { CITY_FBI_BASELINES } from "./fbi-baselines.js";

// fix(audit legal-accuracy-1): expose the FBI national benchmark so the
// canonical methodology page renders the SAME numbers the scoring engine
// uses, instead of a hand-typed copy that drifted (page said 364/1,896 while
// the engine compared against 328/1,548).
export { FBI_NATIONAL_PER_100K_2025, FBI_NATIONAL_SOURCE } from "./safety-score.js";

// Cities + neighborhoods registry.
export type { CityEntry } from "./cities.js";
export {
  CITIES,
  cityBySlug,
  cityForArea,
  cityFromLatLng,
  nearestCityByCentroid,
} from "./cities.js";

export {
  listKnownAreas,
  listKnownAreasSync,
  nearestArea,
  findArea,
  SD_AREAS,
} from "./neighborhoods.js";
