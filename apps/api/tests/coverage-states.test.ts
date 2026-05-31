import { describe, it, expect } from "vitest";
import { CITIES } from "@travelsafe/crime-data/cities";
import { CITY_STATES, stateAbbrForCity } from "@travelsafe/crime-data/city-states";

// v99 — guards two production gaps the user hit: cities with no associated
// state (the coverage dashboard showed "—") and, more generally, the
// CITY_STATES map drifting behind the CITIES registry as cities are added.
// Sourcing the assertion from CITIES means a newly-added city MUST get a
// state here or this test fails — the drift can't recur silently.
describe("CITY_STATES covers every supported city", () => {
  it("maps every CITIES slug to a non-dash state", () => {
    for (const city of CITIES) {
      const abbr = stateAbbrForCity(city.slug);
      expect(abbr, `missing/invalid state for ${city.slug}`).not.toBe("—");
      expect(abbr, `state abbr for ${city.slug} should be 2 letters`).toMatch(/^[A-Z]{2}$/);
      expect(CITY_STATES[city.slug]?.label, `missing state label for ${city.slug}`).toBeTruthy();
    }
  });
});
