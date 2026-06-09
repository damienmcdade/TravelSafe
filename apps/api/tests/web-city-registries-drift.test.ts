import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CITIES } from "@travelsafe/crime-data/cities";

// Guard against the registry-drift bug class: two hand-maintained side-registries
// in apps/web — OFFICIAL_ALERTS_CITY_META (drives NWS weather / USGS quakes /
// AMBER / road-conditions) and COVERAGE_BASELINE (the coverage dashboard's
// cold-start fallback) — must stay in lockstep with the canonical CITIES
// registry. When they drifted, two MD counties (and houston/nashville) silently
// lost Official Alerts and showed "warming-up · 0" on /coverage. These modules
// use `import "server-only"` + `@/` aliases that can't be imported into the API
// vitest, so we parse their source text for the slug keys instead. Sourcing the
// assertion from CITIES means a newly-added city MUST appear in both files (and a
// removed city MUST be deleted) or this test fails — the drift can't recur.
const here = dirname(fileURLToPath(import.meta.url));
const webSrc = resolve(here, "../../web/src/server/services");

function slugKeys(relPath: string): string[] {
  const txt = readFileSync(resolve(webSrc, relPath), "utf8");
  // Match the record keys: `"slug": {` at the start of an entry.
  return [...txt.matchAll(/^\s*"([a-z0-9-]+)":\s*\{/gm)].map((m) => m[1]);
}

const citySlugs = CITIES.map((c) => c.slug).sort();

describe("apps/web city side-registries stay in sync with CITIES", () => {
  for (const [name, relPath] of [
    ["OFFICIAL_ALERTS_CITY_META", "official-alerts/city-meta.ts"],
    ["COVERAGE_BASELINE", "coverage/baseline.ts"],
  ] as const) {
    it(`${name} covers exactly the CITIES registry (no missing, no stale)`, () => {
      const keys = slugKeys(relPath).filter((k) => k !== "slug").sort();
      const missing = citySlugs.filter((s) => !keys.includes(s));
      const stale = keys.filter((s) => !citySlugs.includes(s));
      expect(missing, `${name} missing slugs`).toEqual([]);
      expect(stale, `${name} stale slugs`).toEqual([]);
    });
  }
});
