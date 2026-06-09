import { describe, it, expect } from "vitest";
import { statePlaneToLatLng } from "@travelsafe/crime-data/adapters/milwaukee-ckan";

// Regression guard for the Milwaukee WIBR RoughX/RoughY → WGS84 transform that
// powers point-in-polygon neighborhood assignment (v110). The CRS is Wisconsin
// South State Plane (NAD83/GRS80) with the legacy 2,000,000 ftUS false easting.
// These reference points are real WIBR records whose street addresses geocode
// to the expected lat/lng (calibrated to ~25 m mean error; verified identical
// to proj4 to <1 mm). If the projection constants drift, every incident lands
// in the wrong neighborhood — this test fails loudly first.
const CASES: Array<{ x: number; y: number; lat: number; lng: number; label: string }> = [
  { x: 2541093.9, y: 394459.9, lat: 43.06437, lng: -87.97516, label: "4900 W Wright St" },
  { x: 2554035.3, y: 401558.0, lat: 43.08289, lng: -87.92579, label: "3554 N 12th St" },
  { x: 2531990.9, y: 400734.2, lat: 43.08206, lng: -88.00890, label: "3471 N 77th St" },
  { x: 2551560.1, y: 364842.8, lat: 42.98234, lng: -87.93841, label: "3428 S 20th St" },
];

function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toR = (v: number) => (v * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

describe("milwaukee statePlaneToLatLng", () => {
  it("lands every reference point within ~100 m of its geocoded address", () => {
    for (const c of CASES) {
      const got = statePlaneToLatLng(c.x, c.y);
      const err = metersBetween(got, { lat: c.lat, lng: c.lng });
      expect(err, `${c.label}: ${got.lat.toFixed(5)},${got.lng.toFixed(5)} off by ${err.toFixed(0)}m`).toBeLessThan(100);
    }
  });

  it("puts points inside the Milwaukee bounding box", () => {
    for (const c of CASES) {
      const { lat, lng } = statePlaneToLatLng(c.x, c.y);
      expect(lat).toBeGreaterThan(42.9);
      expect(lat).toBeLessThan(43.2);
      expect(lng).toBeGreaterThan(-88.1);
      expect(lng).toBeLessThan(-87.8);
    }
  });
});
