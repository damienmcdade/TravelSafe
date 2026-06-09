import { describe, it, expect } from "vitest";
import { CITIES } from "@travelsafe/crime-data/cities";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Guard the client-safe apps/web/src/lib/city-meta.ts against drift from the
// canonical server maps. TimeOfDayCard (a "use client" component) can't import
// the server-only crime-data package, so it reads city-meta.ts — which previously
// hand-duplicated these tables and drifted (wrong prefixes for 7 live cities →
// UTC time-of-day histograms). We parse city-meta.ts's source and assert its
// three tables exactly match the canonical AREA_SLUG_PREFIX / CITY_TIMEZONES /
// DATE_ONLY_CITY_SLUGS restricted to the live CITIES registry.
const here = dirname(fileURLToPath(import.meta.url));
const metaPath = resolve(here, "../../web/src/lib/city-meta.ts");
const cityMetaSrc = readFileSync(metaPath, "utf8");

function parseRecordBlock(varName: string): Record<string, string> {
  const m = cityMetaSrc.match(new RegExp(`export const ${varName}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`));
  if (!m) throw new Error(`could not parse ${varName} from city-meta.ts`);
  const out: Record<string, string> = {};
  for (const pair of m[1].matchAll(/"([a-z0-9-]+)":\s*"([^"]*)"/g)) out[pair[1]] = pair[2];
  return out;
}
function parseSetBlock(varName: string): Set<string> {
  const m = cityMetaSrc.match(new RegExp(`export const ${varName}[^=]*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`));
  if (!m) throw new Error(`could not parse ${varName} from city-meta.ts`);
  return new Set([...m[1].matchAll(/"([a-z0-9-]+)"/g)].map((x) => x[1]));
}

// Parse the canonical maps from source (cities.ts AREA_SLUG_PREFIX, city-time.ts
// CITY_TIMEZONES + DATE_ONLY_CITY_SLUGS) so this test needs no server-only import
// beyond CITIES (which the package exports).
const pkgSrc = resolve(here, "../../../packages/crime-data/src");
function recordFrom(file: string, varName: string): Record<string, string> {
  const src = readFileSync(resolve(pkgSrc, file), "utf8");
  const m = src.match(new RegExp(`${varName}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`));
  if (!m) throw new Error(`could not parse ${varName} from ${file}`);
  const out: Record<string, string> = {};
  for (const pair of m[1].matchAll(/"([a-z0-9-]+)":\s*"([^"]*)"/g)) out[pair[1]] = pair[2];
  return out;
}
function setFrom(file: string, varName: string): Set<string> {
  const src = readFileSync(resolve(pkgSrc, file), "utf8");
  const m = src.match(new RegExp(`${varName}[^=]*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`));
  if (!m) throw new Error(`could not parse ${varName} from ${file}`);
  return new Set([...m[1].matchAll(/"([a-z0-9-]+)"/g)].map((x) => x[1]));
}
const canonicalPrefixes = () => recordFrom("cities.ts", "const AREA_SLUG_PREFIX");
const CITY_TIMEZONES = recordFrom("lib/city-time.ts", "export const CITY_TIMEZONES");
const DATE_ONLY_CITY_SLUGS = setFrom("lib/city-time.ts", "export const DATE_ONLY_CITY_SLUGS");

const liveSlugs = new Set(CITIES.map((c) => c.slug));

describe("city-meta.ts client mirror stays in sync with the server canonical", () => {
  it("AREA_SLUG_PREFIX matches cities.ts (+ san-diego empty prefix), exactly the live cities", () => {
    const client = parseRecordBlock("AREA_SLUG_PREFIX");
    const server = canonicalPrefixes();
    // san-diego is "" in the client mirror; the server map omits it (bare slugs).
    expect(client["san-diego"]).toBe("");
    for (const slug of liveSlugs) {
      if (slug === "san-diego") continue;
      expect(client[slug], `prefix for ${slug}`).toBe(server[slug]);
    }
    // No stale (removed-city) keys in the client mirror.
    for (const k of Object.keys(client)) expect(liveSlugs.has(k), `stale prefix key ${k}`).toBe(true);
  });

  it("CITY_TZ matches CITY_TIMEZONES for every live city, with no stale keys", () => {
    const client = parseRecordBlock("CITY_TZ");
    for (const slug of liveSlugs) {
      expect(client[slug], `tz for ${slug}`).toBe(CITY_TIMEZONES[slug]);
    }
    for (const k of Object.keys(client)) expect(liveSlugs.has(k), `stale tz key ${k}`).toBe(true);
  });

  it("DATE_ONLY_SLUGS matches DATE_ONLY_CITY_SLUGS exactly", () => {
    const client = parseSetBlock("DATE_ONLY_SLUGS");
    expect([...client].sort()).toEqual([...DATE_ONLY_CITY_SLUGS].sort());
  });
});
