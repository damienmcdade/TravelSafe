import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CITIES } from "@travelsafe/crime-data/cities";
import { CITY_POPULATION } from "@travelsafe/crime-data/population";
import { CITY_FBI_BASELINES } from "@travelsafe/crime-data/fbi-baselines";

// fix(audit infra): crime-data shipped with NO automated tests, so a city added
// to the registry without its population / FBI baseline / GeoJSON boundary — or
// an adapter wired to the wrong export — could merge unnoticed and silently
// degrade that city's scores. This integrity test runs inside the existing API
// vitest suite (already a CI merge gate) and asserts the full cross-coverage the
// scoring engine assumes.

const cities = Array.isArray(CITIES) ? CITIES : Object.values(CITIES);

const here = dirname(fileURLToPath(import.meta.url));
// apps/api/tests → repo root → apps/web/public/geo
const geoDir = join(here, "..", "..", "web", "public", "geo");
const geojsonSlugs = new Set(
  readdirSync(geoDir)
    .filter((f) => f.endsWith(".geojson"))
    .map((f) => f.replace(/\.geojson$/, "")),
);

describe("crime-data city registry integrity", () => {
  it("registry is non-empty and each entry is well-formed", () => {
    expect(cities.length).toBeGreaterThanOrEqual(45);
    for (const c of cities) {
      expect(typeof c.slug, `slug for ${c.label}`).toBe("string");
      expect(typeof c.label, `label for ${c.slug}`).toBe("string");
      expect(typeof c.adapter, `adapter for ${c.slug}`).toBe("object");
      expect(typeof c.discover, `discover() for ${c.slug}`).toBe("function");
    }
  });

  it("every city has a Census population entry", () => {
    const missing = cities.filter((c) => CITY_POPULATION[c.slug] == null).map((c) => c.slug);
    expect(missing, `cities missing population`).toEqual([]);
  });

  it("every city has an FBI baseline (violent + property)", () => {
    const missing = cities.filter((c) => {
      const b = CITY_FBI_BASELINES[c.slug];
      return !b || !(b.violent > 0) || !(b.property > 0);
    }).map((c) => c.slug);
    expect(missing, `cities missing/zero FBI baseline`).toEqual([]);
  });

  it("every city has a GeoJSON boundary file", () => {
    const missing = cities.filter((c) => !geojsonSlugs.has(c.slug)).map((c) => c.slug);
    expect(missing, `cities missing public/geo/<slug>.geojson`).toEqual([]);
  });

  it("city slugs are unique", () => {
    const slugs = cities.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
