// Cities registry now lives in @travelsafe/crime-data. This wrapper
// re-exports for backwards compat with existing import paths.
//
// New consumers should import directly from @travelsafe/crime-data.
export type { CityEntry } from "@travelsafe/crime-data";
export {
  CITIES,
  cityBySlug,
  cityForArea,
  cityFromLatLng,
  nearestCityByCentroid,
} from "@travelsafe/crime-data/cities";
