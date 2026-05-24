#!/usr/bin/env node
/**
 * Pull each supported city's own FBI-published per-100k rates from
 * the Crime Data Explorer (CDE) and emit them as a constant table
 * the runtime scoring uses as the authoritative citywide baseline.
 *
 * Why this matters: comparing every city's adapter-derived rate
 * against ONE national average (currently 328 violent / 1548
 * property per 100k) was producing grade-E for every major US
 * city, because urban cities consistently sit 2-7× the national
 * rate (national includes rural + suburban). The honest comparison
 * is each city's own FBI-published rate — the CDE returns it via
 *   /summarized/agency/{ORI}/{offense}
 * alongside the state + national rates for reference.
 *
 * Requires:
 *   FBI_CDE_API_KEY=...  free signup at https://api.data.gov/signup/
 *
 * Run:
 *   FBI_CDE_API_KEY=$KEY node tools/build-city-fbi-baselines.mjs
 *
 * Output:
 *   apps/web/src/server/services/watch/city-fbi-baselines-generated.ts
 *
 * Re-run after each new ACS / CDE month. Idempotent + deterministic.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(
  REPO_ROOT,
  "apps/web/src/server/services/watch/city-fbi-baselines-generated.ts",
);

const KEY = process.env.FBI_CDE_API_KEY;
if (!KEY) {
  console.error("FBI_CDE_API_KEY env var required.");
  process.exit(1);
}

// FBI ORI per city. The "primary" PD per metro — for cities served
// by multiple agencies (e.g., Vegas = LVMPD vs Henderson, NOLA =
// NOPD vs LA State Police) we pick the one whose jurisdiction
// matches our adapter's data feed. ORIs are the FBI's canonical
// 9-character agency IDs.
const CITY_TO_ORI = {
  "san-diego":     "CA0371100",   // San Diego Police Department
  "los-angeles":   "CA0194200",   // Los Angeles Police Department
  "san-francisco": "CA0380100",   // San Francisco Police Department
  "oakland":       "CA0010900",   // Oakland Police Department
  "chicago":       "ILCPD0000",   // Chicago Police Department (uses non-FIPS ORI)
  "new-york":      "NY0303000",   // New York City Police Department
  "seattle":       "WA0171000",   // Seattle Police Department
  "denver":        "CO0160000",   // Denver Police Department
  "detroit":       "MI8234900",   // Detroit Police Department
  "washington-dc": "DCMPD0000",   // DC Metropolitan Police Department
  "boston":        "MA0130100",   // Boston Police Department
  "philadelphia":  "PAPEP0000",   // Philadelphia Police Department
  "cincinnati":    "OH0310200",   // Cincinnati Police Department
  "new-orleans":   "LANPD0000",   // New Orleans Police Department
  "baton-rouge":   "LA0170100",   // Baton Rouge Police Department
  "cambridge":     "MA0170300",   // Cambridge Police Department
  "dallas":        "TXDPD0000",   // Dallas Police Department
  "charlotte":     "NCCMPD0000",  // Charlotte-Mecklenburg Police Department
  "nashville":     "TNMNPD0000",  // Metro Nashville Police Department
  "minneapolis":   "MNMPD0000",   // Minneapolis Police Department
  "cleveland":     "OH0181800",   // Cleveland Police Department
  "milwaukee":     "WIMPD0000",   // Milwaukee Police Department
  "las-vegas":     "NVLVM0000",   // Las Vegas Metropolitan Police Department
  "boise":         "ID0010100",   // Boise Police Department
  "buffalo":       "NY0140200",   // Buffalo Police Department
  "tucson":        "AZ0100200",   // Tucson Police Department
  "kansas-city":   "MO0480000",   // Kansas City MO Police Department
  "saint-paul":    "MN0620900",   // Saint Paul Police Department
  "pittsburgh":    "PAPPD0000",   // Pittsburgh Bureau of Police
  "phoenix":       "AZ0072700",   // Phoenix Police Department
};

async function fetchAgencyAnnual(ori, offense) {
  const now = new Date().getUTCFullYear();
  const url = `https://api.usa.gov/crime/fbi/cde/summarized/agency/${ori}/${offense}?from=01-${now - 5}&to=12-${now}&API_KEY=${KEY}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`CDE ${res.status} ${ori}/${offense}`);
  const data = await res.json();
  // The response has a "rates" map with multiple series. We want the
  // one keyed by the agency's full name (e.g., "Los Angeles Police
  // Department Offenses"). It's always the third-or-later series.
  const ratesByCat = data?.offenses?.rates ?? {};
  let agencyRates = null;
  for (const [k, v] of Object.entries(ratesByCat)) {
    if (k.endsWith("Offenses") && !k.startsWith("United States") && !k.includes("Clearances")) {
      // Skip state-level series (e.g., "California Offenses"). State
      // names happen to be short; agency names include "Department"
      // or "Bureau" or "Office".
      if (k.includes("Department") || k.includes("Bureau") || k.includes("Office") || k.includes("Police") || k.includes("Metropolitan")) {
        agencyRates = v;
        break;
      }
    }
  }
  if (!agencyRates) return null;
  // Annualize: sum 12 months per year, only keep years that have
  // all 12 months reported.
  const byYear = new Map();
  for (const [mmYYYY, rate] of Object.entries(agencyRates)) {
    if (rate == null) continue;
    const [, year] = mmYYYY.split("-");
    const bucket = byYear.get(year) ?? { sum: 0, n: 0 };
    bucket.sum += Number(rate);
    bucket.n += 1;
    byYear.set(year, bucket);
  }
  const annual = [];
  for (const [year, { sum, n }] of byYear) {
    if (n === 12) annual.push({ year: Number(year), rate: sum });
  }
  annual.sort((a, b) => b.year - a.year);
  return annual[0] ?? null; // most-recent complete year
}

async function main() {
  const out = {};
  const skipped = [];
  let latestYear = 0;
  for (const [citySlug, ori] of Object.entries(CITY_TO_ORI)) {
    process.stdout.write(`${citySlug.padEnd(18)} (${ori}) ... `);
    try {
      const [violent, property] = await Promise.all([
        fetchAgencyAnnual(ori, "violent-crime"),
        fetchAgencyAnnual(ori, "property-crime"),
      ]);
      if (!violent || !property) {
        console.log("no agency data");
        skipped.push(citySlug);
        continue;
      }
      const year = Math.min(violent.year, property.year);
      out[citySlug] = {
        violent: Math.round(violent.rate),
        property: Math.round(property.rate),
        year,
        ori,
      };
      latestYear = Math.max(latestYear, year);
      console.log(`${year}: V=${Math.round(violent.rate)} Pr=${Math.round(property.rate)}`);
    } catch (err) {
      console.log(`ERR ${err.message}`);
      skipped.push(citySlug);
    }
  }
  const lines = [
    `// AUTO-GENERATED by tools/build-city-fbi-baselines.mjs`,
    `// Source: FBI Crime Data Explorer (api.usa.gov/crime/fbi/cde)`,
    `// per-agency annual rates per 100,000 residents.`,
    `//`,
    `// Each entry is the city's OWN FBI-published rate — the`,
    `// authoritative comparison anchor for citywide scoring. Used`,
    `// instead of the FBI national average, which is structurally`,
    `// pulled down by rural areas and makes every urban city`,
    `// collapse to grade E.`,
    `//`,
    `// DO NOT EDIT BY HAND. Re-run the build script after each new`,
    `// CDE month publishes.`,
    ``,
    `export interface CityFbiBaseline {`,
    `  /// Per-100k annual rate for NIBRS Crimes Against Persons /`,
    `  /// UCR Violent Crime, summed across 12 months of the latest`,
    `  /// complete year.`,
    `  violent: number;`,
    `  /// Same for Crimes Against Property.`,
    `  property: number;`,
    `  /// Reporting year these rates apply to.`,
    `  year: number;`,
    `  /// FBI 9-character ORI for the city's reporting agency.`,
    `  ori: string;`,
    `}`,
    ``,
    `export const CITY_FBI_BASELINES: Record<string, CityFbiBaseline> = {`,
  ];
  for (const slug of Object.keys(out).sort()) {
    const b = out[slug];
    lines.push(`  ${JSON.stringify(slug)}: { violent: ${b.violent}, property: ${b.property}, year: ${b.year}, ori: ${JSON.stringify(b.ori)} },`);
  }
  lines.push(`};`);
  lines.push(``);
  await fs.writeFile(OUTPUT_PATH, lines.join("\n"));
  console.log(`\nWrote ${OUTPUT_PATH}`);
  console.log(`  ${Object.keys(out).length} cities populated, ${skipped.length} skipped`);
  if (skipped.length > 0) console.log(`  skipped: ${skipped.join(", ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
