// Neighborhoods discovery now lives in @travelsafe/crime-data. This
// wrapper re-exports for backwards compat with existing import paths.
//
// New consumers should import directly from @travelsafe/crime-data.
export type { KnownArea } from "@travelsafe/crime-data";
export {
  listKnownAreas,
  listKnownAreasSync,
  nearestArea,
  findArea,
  SD_AREAS,
} from "@travelsafe/crime-data";
