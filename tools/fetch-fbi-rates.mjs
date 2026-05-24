#!/usr/bin/env node
/**
 * Pull the latest FBI Crime Data Explorer national rates per 100k
 * and emit the constants the runtime consumes. Use this whenever the
 * FBI publishes a new annual release (typically October each year).
 *
 * Requires an api.data.gov key — free signup at https://api.data.gov/signup/
 * Set as env var:
 *   FBI_CDE_API_KEY=... node tools/fetch-fbi-rates.mjs
 *
 * Output is printed to stdout. Paste the resulting values into
 * apps/web/src/server/services/watch/safety-score.ts → FBI_NATIONAL_PER_100K_*.
 *
 * CDE endpoints (require key):
 *   /api/data/national/violent-crime/{from}/{to}
 *   /api/data/national/property-crime/{from}/{to}
 *
 * Returns: rates per 100k by year. We take the most-recent year
 * with non-zero data as the "latest annual release" and print both
 * that year's numbers and a citation string ready to drop into the
 * source code.
 */

const KEY = process.env.FBI_CDE_API_KEY;
if (!KEY) {
  console.error("FBI_CDE_API_KEY env var required.");
  console.error("Get one at https://api.data.gov/signup/ — free, instant.");
  process.exit(1);
}

const ENDPOINTS = {
  // The CDE national-rate endpoints. These return rate per 100k by
  // year for the violent-crime aggregate (NIBRS "Crimes Against
  // Persons" + the legacy UCR violent crimes) and property-crime
  // aggregate.
  violent:  "/api/estimates/national/violent-crime",
  property: "/api/estimates/national/property-crime",
};

const BASE = "https://api.usa.gov/crime/fbi/cde";

async function fetchSeries(path) {
  // Pull a 10-year window so we always have at least one filled year.
  const now = new Date().getUTCFullYear();
  const url = `${BASE}${path}/${now - 10}/${now}?API_KEY=${KEY}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`FBI CDE ${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function extractLatestRate(payload) {
  // CDE response shape varies between endpoints. The estimates
  // endpoints typically return { results: [{ year, rate_per_100000 }] }.
  // We pick the most-recent year that has a non-zero, finite rate.
  const candidates = (payload.results ?? payload ?? [])
    .map((r) => ({
      year: Number(r.data_year ?? r.year),
      rate: Number(r.violent_crime_rate ?? r.property_crime_rate ?? r.rate ?? r.rate_per_100000),
    }))
    .filter((r) => Number.isFinite(r.year) && Number.isFinite(r.rate) && r.rate > 0)
    .sort((a, b) => b.year - a.year);
  return candidates[0] ?? null;
}

async function main() {
  const [violent, property] = await Promise.all([
    fetchSeries(ENDPOINTS.violent),
    fetchSeries(ENDPOINTS.property),
  ]);
  const vLatest = extractLatestRate(violent);
  const pLatest = extractLatestRate(property);
  if (!vLatest || !pLatest) {
    console.error("Could not extract latest rate. Raw payloads:");
    console.error("violent:", JSON.stringify(violent).slice(0, 600));
    console.error("property:", JSON.stringify(property).slice(0, 600));
    process.exit(2);
  }
  const year = Math.max(vLatest.year, pLatest.year);
  console.log("\n// Paste into apps/web/src/server/services/watch/safety-score.ts:\n");
  console.log(`export const FBI_NATIONAL_PER_100K_${year} = { PERSONS: ${Math.round(vLatest.rate)}, PROPERTY: ${Math.round(pLatest.rate)} };`);
  console.log(`export const FBI_NATIONAL_SOURCE = {`);
  console.log(`  label: "FBI Crime in the Nation ${year} (Uniform Crime Reporting)",`);
  console.log(`  url: "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend",`);
  console.log(`  publishedYear: ${year},`);
  console.log(`};`);
  console.log(`\n// Verbose source data:`);
  console.log(`//   violent  ${vLatest.year}: ${vLatest.rate.toFixed(1)} per 100k (rounded ${Math.round(vLatest.rate)})`);
  console.log(`//   property ${pLatest.year}: ${pLatest.rate.toFixed(1)} per 100k (rounded ${Math.round(pLatest.rate)})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
