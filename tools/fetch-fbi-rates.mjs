#!/usr/bin/env node
/**
 * Pull the latest FBI Crime Data Explorer national rates per 100k
 * and emit the constants the runtime consumes. Use this whenever
 * the CDE publishes a new month of data.
 *
 * Requires an api.data.gov key — free signup at
 * https://api.data.gov/signup/. Set as env var:
 *   FBI_CDE_API_KEY=... node tools/fetch-fbi-rates.mjs
 *
 * Endpoint: https://api.usa.gov/crime/fbi/cde/summarized/national/
 *   {offense}?from=MM-YYYY&to=MM-YYYY&API_KEY=...
 *
 * The CDE returns MONTHLY rates per 100k. We sum 12 months per year
 * to get the annual rate. The most-recent year with 12 complete
 * months is the "latest" we publish — partial years are skipped to
 * avoid annualizing from an incomplete dataset.
 *
 * Note: the CDE publishes more frequently than the FBI's annual
 * "Crime in the Nation" release (which is Oct-each-year). When this
 * script reports a year newer than the most recent annual release,
 * those numbers are CDE-confirmed but may still be revised slightly
 * when the official annual is published.
 */

const KEY = process.env.FBI_CDE_API_KEY;
if (!KEY) {
  console.error("FBI_CDE_API_KEY env var required.");
  console.error("Get one at https://api.data.gov/signup/ — free, instant.");
  process.exit(1);
}

const BASE = "https://api.usa.gov/crime/fbi/cde/summarized/national";

async function fetchAnnualRates(offense) {
  const now = new Date().getUTCFullYear();
  const url = `${BASE}/${offense}?from=01-${now - 10}&to=12-${now}&API_KEY=${KEY}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CDE ${res.status} ${offense}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const monthly = data?.offenses?.rates?.["United States Offenses"] ?? {};
  // Bucket by year and only keep years where ALL 12 months are
  // present AND non-null. The CDE returns the full requested range
  // but pads incomplete years with `null` for unfiled months; if we
  // counted those as zero, partial 2026 would sum to ~95 per 100k
  // and look like an absurd violent-crime cliff.
  const byYear = new Map();
  for (const [mmYYYY, rate] of Object.entries(monthly)) {
    const [, year] = mmYYYY.split("-");
    const bucket = byYear.get(year) ?? { sum: 0, n: 0 };
    if (rate != null && Number.isFinite(Number(rate))) {
      bucket.sum += Number(rate);
      bucket.n += 1;
    }
    byYear.set(year, bucket);
  }
  const annual = [];
  for (const [year, { sum, n }] of byYear) {
    if (n === 12) annual.push({ year: Number(year), rate: sum });
  }
  annual.sort((a, b) => b.year - a.year);
  return annual;
}

async function main() {
  const [violent, property] = await Promise.all([
    fetchAnnualRates("violent-crime"),
    fetchAnnualRates("property-crime"),
  ]);
  if (violent.length === 0 || property.length === 0) {
    console.error("No complete annual data available.");
    process.exit(2);
  }
  // Use the latest year that's complete in BOTH series — keeps the
  // pair internally consistent even if one offense lags by a month.
  const sharedYears = new Set(violent.map((v) => v.year));
  const latest = property.find((p) => sharedYears.has(p.year))?.year;
  if (!latest) {
    console.error("No overlapping complete year between violent + property series.");
    process.exit(3);
  }
  const v = violent.find((r) => r.year === latest);
  const p = property.find((r) => r.year === latest);

  console.log(`\nLatest complete year in BOTH series: ${latest}`);
  console.log(`  violent  : ${v.rate.toFixed(1)} per 100k  (rounded ${Math.round(v.rate)})`);
  console.log(`  property : ${p.rate.toFixed(1)} per 100k  (rounded ${Math.round(p.rate)})`);
  console.log(`\n// Paste into apps/web/src/server/services/watch/safety-score.ts:\n`);
  console.log(`export const FBI_NATIONAL_PER_100K_${latest} = { PERSONS: ${Math.round(v.rate)}, PROPERTY: ${Math.round(p.rate)} };`);
  console.log(`export const FBI_NATIONAL_SOURCE = {`);
  console.log(`  label: "FBI Crime Data Explorer ${latest} (annual sum of monthly UCR rates)",`);
  console.log(`  url: "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend",`);
  console.log(`  publishedYear: ${latest},`);
  console.log(`};`);

  console.log(`\n// Year-over-year context:`);
  for (let i = 0; i < Math.min(5, violent.length); i++) {
    const vr = violent[i];
    const pr = property.find((r) => r.year === vr.year);
    console.log(`//   ${vr.year}: violent ${vr.rate.toFixed(1)} | property ${pr ? pr.rate.toFixed(1) : "—"}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
