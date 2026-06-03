#!/usr/bin/env node
// fix(audit perf-geo-1): the city polygon GeoJSON under apps/web/public/geo was
// stored at full float precision (12-13 decimals ≈ sub-micron) and pretty-
// printed — Honolulu 2.0MB / SF 1.5MB / Raleigh 1.3MB for a handful of polygons.
// Neighborhood boundaries don't need better than ~1m, so round every COORDINATE
// to 5 decimals (~1.1m) and minify. Only numbers inside `coordinates` arrays are
// touched — feature properties (populations, ids) are left exact. Deterministic;
// re-run any time. Usage: node tools/shrink-geojson.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEO_DIR = path.join(__dirname, "..", "apps/web/public/geo");
const DECIMALS = 5;

function roundCoords(node) {
  if (Array.isArray(node)) {
    // A coordinate pair is [number, number(, number)]; round numbers in place.
    if (node.length && node.every((v) => typeof v === "number")) {
      return node.map((v) => Math.round(v * 1e5) / 1e5);
    }
    return node.map(roundCoords);
  }
  return node;
}

function shrinkGeometry(geom) {
  if (geom && geom.coordinates) geom.coordinates = roundCoords(geom.coordinates);
  return geom;
}

let totalBefore = 0, totalAfter = 0;
const entries = await fs.readdir(GEO_DIR);
for (const name of entries.filter((n) => n.endsWith(".geojson")).sort()) {
  const file = path.join(GEO_DIR, name);
  const raw = await fs.readFile(file, "utf8");
  const before = Buffer.byteLength(raw);
  const json = JSON.parse(raw);
  if (json.type === "FeatureCollection" && Array.isArray(json.features)) {
    for (const f of json.features) if (f.geometry) shrinkGeometry(f.geometry);
  } else if (json.type === "Feature") {
    shrinkGeometry(json.geometry);
  } else if (json.coordinates) {
    shrinkGeometry(json);
  }
  const out = JSON.stringify(json); // minified
  const after = Buffer.byteLength(out);
  await fs.writeFile(file, out);
  totalBefore += before; totalAfter += after;
  const pct = Math.round((1 - after / before) * 100);
  console.log(`${name.padEnd(28)} ${(before / 1024).toFixed(0).padStart(6)}KB -> ${(after / 1024).toFixed(0).padStart(6)}KB  (-${pct}%)`);
}
console.log(`\nTOTAL  ${(totalBefore / 1048576).toFixed(2)}MB -> ${(totalAfter / 1048576).toFixed(2)}MB  (-${Math.round((1 - totalAfter / totalBefore) * 100)}%)`);
