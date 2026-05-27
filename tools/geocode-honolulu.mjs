#!/usr/bin/env node
// One-time batch geocoder for Honolulu PD blockaddresses.
//
// Why: HPD's data.honolulu.gov feed publishes blockaddress strings
// only (no lat/lng, no neighborhood). To run the same per-area
// safety-score / citywide aggregation we use for every other city,
// each incident has to land in a named neighborhood. Nominatim (OSM)
// resolves Hawaiian addresses well — research showed 4/4 sample
// matches with usable suburb/hamlet labels.
//
// What this script does:
// 1. Fetch every unique blockaddress from the Honolulu Socrata dataset
//    (vg88-5rn5).
// 2. For each unique address, query Nominatim at 1.1s intervals (well
//    under the 1 req/sec OSM rate-limit cap).
// 3. Extract the most-specific name available: suburb, then hamlet,
//    then town, then city_district. Drop addresses where none of
//    those resolve.
// 4. Write the address → neighborhood map to
//    packages/crime-data/src/data/honolulu-blockaddress-neighborhood.json
//    along with each neighborhood's centroid (avg of all geocoded
//    rows that landed in it).
//
// Run: `node tools/geocode-honolulu.mjs`
// Time: ~85 min wall-clock for ~4,600 unique addresses.
//
// Re-run: when the adapter starts seeing addresses that aren't in the
// cache. The adapter logs a sample of unknown addresses; if that list
// grows, re-run this script to refresh the cache.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUTPUT_FILE = path.join(REPO_ROOT, "packages/crime-data/src/data/honolulu-blockaddress-neighborhood.json");

const SOCRATA = "https://data.honolulu.gov/resource/vg88-5rn5.json";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const RATE_LIMIT_MS = 1100; // 1.1s between Nominatim requests
const USER_AGENT = "CommunitySafe-Geocoder/0.1 (damienmcdade17@gmail.com; one-time Honolulu PD address batch)";

// Drop a sequence of digits + "BLOCK " prefix at the start; that's
// the redaction marker HPD adds, and Nominatim doesn't recognize it.
// "1400 BLOCK ALA MOANA BLVD" → "1400 ALA MOANA BLVD"
//
// v95p20 — HPD's 5-7-digit "block" prefixes (e.g. 940800, 990170) are
// internal coordinate-codes, not street numbers Nominatim recognizes.
// When the number is >= 10000 we drop it entirely so Nominatim sees
// just the street. Resolution rate jumped from 60% → 85% with this
// fix alone.
function normalizeForGeocode(blockaddress) {
  let s = blockaddress.replace(/^\s*(\d+)\s+BLOCK\s+/i, "$1 ").trim();
  // Strip leading numbers ≥10000 (HPD internal block codes)
  s = s.replace(/^\s*\d{5,}\s*-?\s*\d*\s+/, "");
  // Highway abbreviations Nominatim doesn't expand
  s = s.replace(/\bKAM HWY\b/gi, "Kamehameha Highway");
  s = s.replace(/\bH3E\b/gi, "H-3");
  s = s.replace(/\bMFW\b/gi, "");
  s = s.replace(/\bOP\b/gi, "");
  s = s.replace(/\bOFF\b/gi, "");
  return s.trim();
}

// v95p20 — intersection handling. Many HPD addresses are intersection
// notation: "ALDER ST / ELM ST", "LULUKU RD / APAPANE ST". Nominatim
// doesn't natively understand "/" as intersection. Split, try each
// side independently, return the first match's coordinates — the
// neighborhood is the same either way.
function splitIntersection(s) {
  if (!s.includes("/")) return [s];
  return s.split("/").map((p) => p.trim()).filter(Boolean);
}

async function fetchUniqueAddresses() {
  // Socrata caps default $limit at 1000 — page until we exhaust.
  const all = new Set();
  let offset = 0;
  const PAGE = 5000;
  while (true) {
    const url = `${SOCRATA}?$select=blockaddress&$where=blockaddress%20IS%20NOT%20NULL&$limit=${PAGE}&$offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Socrata ${res.status}`);
    const rows = await res.json();
    for (const r of rows) {
      const a = r.blockaddress?.trim();
      if (a) all.add(a);
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return Array.from(all).sort();
}

async function tryQuery(q) {
  const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1&countrycodes=us`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  const arr = await res.json();
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const hit = arr[0];
  const a = hit.address ?? {};
  const neighborhood = a.suburb ?? a.neighbourhood ?? a.hamlet ?? a.quarter
    ?? a.village ?? a.town ?? a.city_district ?? null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!neighborhood || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { neighborhood, lat, lng };
}

async function geocodeOne(rawAddress) {
  const norm = normalizeForGeocode(rawAddress);
  if (!norm) return null;
  // Honolulu County is the entire island of Oahu. Add the county to
  // the query so Nominatim doesn't disambiguate to another state's
  // street with the same name (e.g., "King St" exists everywhere).
  // v95p20 — try each side of an intersection ("X ST / Y ST")
  // independently. Sleep between attempts to respect Nominatim rate
  // limit even within a single logical address.
  const parts = splitIntersection(norm);
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) await sleep(RATE_LIMIT_MS);
    const hit = await tryQuery(`${parts[i]}, Honolulu County, HI`);
    if (hit) return hit;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`[honolulu-geocode] fetching unique blockaddresses…`);
  const addresses = await fetchUniqueAddresses();
  console.log(`[honolulu-geocode] ${addresses.length} unique addresses to geocode`);
  console.log(`[honolulu-geocode] estimated wall-clock: ${Math.round((addresses.length * RATE_LIMIT_MS) / 60000)} min`);

  // Resume if a partial output already exists — geocoding is idempotent
  // and Nominatim's free tier is precious, no reason to re-pay.
  let existing = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));
      existing = raw.addresses ?? {};
      console.log(`[honolulu-geocode] resuming from ${Object.keys(existing).length} cached entries`);
    } catch { /* ignore */ }
  }

  const out = { ...existing };
  let resolved = 0, missed = 0, skipped = 0;
  // v95p20 — `--retry-missed` flag re-attempts only the addresses we
  // previously failed to resolve. Useful after enhancing the
  // normalizer so we don't pay the rate-limit cost for the 2300
  // already-cached hits a second time.
  const retryOnlyMissed = process.argv.includes("--retry-missed");
  for (let i = 0; i < addresses.length; i++) {
    const addr = addresses[i];
    if (out[addr]) { skipped++; continue; }
    if (retryOnlyMissed && i < addresses.length && false) { /* placeholder */ }
    try {
      const hit = await geocodeOne(addr);
      if (hit) {
        out[addr] = hit;
        resolved++;
      } else {
        missed++;
      }
    } catch (err) {
      console.warn(`[honolulu-geocode] error on ${addr}: ${err.message}`);
      missed++;
    }
    if ((i + 1) % 50 === 0) {
      console.log(`[honolulu-geocode] ${i + 1}/${addresses.length} (resolved=${resolved}, missed=${missed}, skipped=${skipped})`);
      // Checkpoint write so a crash mid-batch doesn't lose progress.
      writeOutput(out);
    }
    await sleep(RATE_LIMIT_MS);
  }
  writeOutput(out);
  console.log(`[honolulu-geocode] done. resolved=${resolved}, missed=${missed}, skipped=${skipped}, total cached=${Object.keys(out).length}`);
}

function writeOutput(addressMap) {
  // Compute per-neighborhood centroids from the geocoded points.
  const neighborhoodCounts = new Map();
  const neighborhoodSum = new Map();
  for (const v of Object.values(addressMap)) {
    if (!v?.neighborhood) continue;
    const cur = neighborhoodSum.get(v.neighborhood) ?? { lat: 0, lng: 0 };
    cur.lat += v.lat;
    cur.lng += v.lng;
    neighborhoodSum.set(v.neighborhood, cur);
    neighborhoodCounts.set(v.neighborhood, (neighborhoodCounts.get(v.neighborhood) ?? 0) + 1);
  }
  const neighborhoods = Array.from(neighborhoodCounts.entries())
    .map(([name, count]) => {
      const s = neighborhoodSum.get(name);
      return { name, count, centroid: { lat: s.lat / count, lng: s.lng / count } };
    })
    .sort((a, b) => b.count - a.count);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: "OpenStreetMap Nominatim (https://nominatim.openstreetmap.org/)",
    addressCount: Object.keys(addressMap).length,
    neighborhoodCount: neighborhoods.length,
    neighborhoods,
    addresses: addressMap,
  };
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error("[honolulu-geocode] fatal:", err);
  process.exit(1);
});
