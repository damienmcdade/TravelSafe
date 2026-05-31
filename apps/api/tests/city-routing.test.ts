import { describe, it, expect } from "vitest";
import { cityForArea } from "@travelsafe/crime-data/cities";

// v99 — regression guard for a production 500 surfaced in the Railway
// logs: `GET /safezone/safety-score?area=la-playa` threw "Unknown area
// slug 'la-playa' — not found in Los Angeles adapter". San Diego is the
// default city and uses name-derived, UNPREFIXED slugs, so SD
// neighborhoods whose names begin with another city's routing prefix
// ("La Jolla"/"La Playa" → "la-", "Oak Park" → "oak-") were misrouted to
// the wrong adapter. These must resolve to San Diego while genuine
// prefixed slugs for those cities keep routing correctly.
describe("cityForArea — San Diego unprefixed-slug collisions", () => {
  it("routes SD neighborhoods that collide with city prefixes to San Diego", () => {
    expect(cityForArea("la-jolla").slug).toBe("san-diego");
    expect(cityForArea("la-playa").slug).toBe("san-diego");
    expect(cityForArea("oak-park").slug).toBe("san-diego");
  });

  it("still routes genuinely-prefixed slugs to the right city", () => {
    expect(cityForArea("la-hollywood").slug).toBe("los-angeles");
    expect(cityForArea("oak-fruitvale").slug).toBe("oakland");
    expect(cityForArea("sf-mission").slug).toBe("san-francisco");
  });

  it("routes other bare SD slugs to San Diego (the default city)", () => {
    expect(cityForArea("pacific-beach").slug).toBe("san-diego");
    expect(cityForArea("linda-vista").slug).toBe("san-diego");
  });
});
