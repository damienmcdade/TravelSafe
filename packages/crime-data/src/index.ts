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

export type { CityFbiBaseline } from "./fbi-baselines.js";
export { CITY_FBI_BASELINES } from "./fbi-baselines.js";

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
