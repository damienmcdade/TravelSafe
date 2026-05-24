#!/usr/bin/env node
/**
 * Build a per-city neighborhood-polygon GeoJSON from Census TIGER
 * ZCTA boundaries. Used for cities whose crime adapter is ZIP-based
 * (Milwaukee, Phoenix). The resulting file is shaped identically to
 * the hand-authored polygon files in apps/web/public/geo/ — same
 * FeatureCollection structure, `properties.name` keyed to the area
 * slug the adapter discovers.
 *
 * For ZIP-based adapters the area slug is `{prefix}-{zip}`. The
 * polygon name MUST slugify back to `{zip}` so the build-neighborhood-
 * populations.mjs pipeline produces `{prefix}-{zip}` keys that match.
 *
 * Source: TigerWeb REST, layer 4 = "2020 Census ZIP Code Tabulation
 * Areas". No API key required.
 *
 * Usage:
 *   node tools/build-zcta-geojson.mjs <city-slug>
 *
 * Currently knows about: milwaukee, phoenix.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const ADAPTERS_DIR = path.join(REPO_ROOT, "apps/web/src/server/services/crime-data/adapters");
const GEO_DIR = path.join(REPO_ROOT, "apps/web/public/geo");

const CITY_CONFIG = {
  milwaukee: { adapter: "milwaukee-ckan.ts", outFile: "milwaukee.geojson" },
  phoenix:   { adapter: "phoenix-socrata.ts", outFile: "phoenix.geojson" },
};

/// Pull the ZIP→neighborhood map straight out of the adapter source.
/// Avoids duplicating the list and means the geojson always reflects
/// whatever the adapter currently recognizes.
async function extractZips(adapterFile) {
  const src = await fs.readFile(path.join(ADAPTERS_DIR, adapterFile), "utf-8");
  const zips = new Set();
  for (const m of src.matchAll(/"(\d{5})"\s*:/g)) zips.add(m[1]);
  return Array.from(zips).sort();
}

async function fetchZcta(zip) {
  const url = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/4/query?where=ZCTA5%3D'${zip}'&outFields=ZCTA5&f=geojson&returnGeometry=true`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`TigerWeb ${res.status} for ZCTA ${zip}`);
  const data = await res.json();
  const feat = data.features?.[0];
  if (!feat) return null;
  return {
    type: "Feature",
    properties: { name: zip },
    geometry: feat.geometry,
  };
}

async function buildCity(slug) {
  const cfg = CITY_CONFIG[slug];
  if (!cfg) throw new Error(`Unknown city slug ${slug}`);
  const zips = await extractZips(cfg.adapter);
  process.stdout.write(`${slug}: ${zips.length} ZIPs ... `);
  const features = [];
  let missing = 0;
  for (const zip of zips) {
    try {
      const f = await fetchZcta(zip);
      if (f) features.push(f);
      else missing++;
    } catch (err) {
      missing++;
      console.warn(`\n  ${zip}: ${err.message}`);
    }
  }
  console.log(`${features.length} features (${missing} missing)`);
  const out = { type: "FeatureCollection", features };
  await fs.writeFile(path.join(GEO_DIR, cfg.outFile), JSON.stringify(out));
  console.log(`  wrote ${cfg.outFile}`);
}

const target = process.argv[2];
if (target) {
  await buildCity(target);
} else {
  for (const slug of Object.keys(CITY_CONFIG)) await buildCity(slug);
}
