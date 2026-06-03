#!/usr/bin/env node
/**
 * Build per-neighborhood populations for every supported city by
 * spatially joining Census ACS 5-year tract populations with each
 * city's neighborhood polygon GeoJSON.
 *
 * Sources (all free, no API key required for our volume):
 *   - Census Reporter (latest ACS 5-year, table B01003 = total
 *     population): https://api.censusreporter.org/1.0/data/show/latest
 *     The official Census Bureau API requires a key for tract-level
 *     queries; Census Reporter is the canonical no-key wrapper.
 *   - TigerWeb tract centroids (INTPTLAT/INTPTLON):
 *     https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query
 *
 * Spatial join: tract centroid → polygon containment via ray-casting.
 * Census tracts target ~4,000 residents and are typically smaller than
 * neighborhoods, so centroid-inside captures most of a tract's
 * population correctly. Polygons that capture zero tract centroids
 * (e.g., tiny downtown polygons where the tract centroid happens to
 * fall just outside) fall back to nearest-tract scaled by area ratio.
 *
 * Output: apps/web/src/server/services/crime-data/neighborhood-
 * populations-generated.ts — a deterministic TS module the runtime
 * imports. Re-run this script whenever you add a city or want to
 * refresh against a newer ACS release.
 *
 * Usage:
 *   node tools/build-neighborhood-populations.mjs
 *
 * Output is written verbatim — no `--dry-run` toggle. The script is
 * idempotent (deterministic output from deterministic input).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const GEO_DIR = path.join(REPO_ROOT, "apps/web/public/geo");
// fix(deploy/coverage): the generated population table was migrated to the
// @travelsafe/crime-data package in v35 (apps/web + apps/api both re-export it
// from there), but this tool still wrote to the dead apps/web-local path — so
// re-runs silently never updated the live data, which is why the committed
// table went stale (LA 23/Boston 12/Philly 21 slugs, Norfolk 0, Phoenix
// 41 ZIP-orphans). Point it at the authoritative package file.
const OUTPUT_PATH = path.join(
  REPO_ROOT,
  "packages/crime-data/src/neighborhood-populations-generated.ts",
);

// Census Reporter resolves "latest" to whichever 5-year release it has.
// We don't pin to a version here — the script re-runs are infrequent
// and we always want the freshest population estimate available.
const CENSUS_REPORTER_BATCH = 80; // ~150 GEOIDs would fit; 80 keeps URL well under 8KB

// City → state + county FIPS + slug-prefix used by the city's adapter
// when discovering neighborhood slugs. The prefix matters because the
// runtime lookup uses the adapter's slug directly; the generated map
// must key by the same slug shape.
//
// FIPS codes from https://www.census.gov/library/reference/code-lists/ansi.html
// Slug prefix derived from the adapter's discover() implementation
// (see apps/web/src/server/services/crime-data/adapters/*.ts) and
// the `cityForArea` switch in cities.ts.
const CITY_CONFIG = {
  "san-diego":     { slugPrefix: "",       counties: [["06", "073"]] },
  "los-angeles":   { slugPrefix: "la-",    counties: [["06", "037"]] },
  "san-francisco": { slugPrefix: "sf-",    counties: [["06", "075"]] },
  "oakland":       { slugPrefix: "oak-",   counties: [["06", "001"]] },
  "chicago":       { slugPrefix: "chi-",   counties: [["17", "031"]] },
  "new-york":      { slugPrefix: "ny-",    counties: [["36", "005"], ["36", "047"], ["36", "061"], ["36", "081"], ["36", "085"]] },
  "seattle":       { slugPrefix: "sea-",   counties: [["53", "033"]] },
  "denver":        { slugPrefix: "den-",   counties: [["08", "031"]] },
  "detroit":       { slugPrefix: "det-",   counties: [["26", "163"]] },
  "washington-dc": { slugPrefix: "dc-",    counties: [["11", "001"]] },
  "boston":        { slugPrefix: "bos-",   counties: [["25", "025"]] },
  "philadelphia":  { slugPrefix: "phl-",   counties: [["42", "101"]] },
  "cincinnati":    { slugPrefix: "cin-",   counties: [["39", "061"]] },
  "new-orleans":   { slugPrefix: "nola-",  counties: [["22", "071"]] },
  "baton-rouge":   { slugPrefix: "br-",    counties: [["22", "033"]] },
  "cambridge":     { slugPrefix: "cam-",   counties: [["25", "017"]] },
  "dallas":        { slugPrefix: "dal-",   counties: [["48", "113"]] },
  "charlotte":     { slugPrefix: "clt-",   counties: [["37", "119"]] },
  "nashville":     { slugPrefix: "nas-",   counties: [["47", "037"]] },
  "minneapolis":   { slugPrefix: "mpls-",  counties: [["27", "053"]] },
  "cleveland":     { slugPrefix: "cle-",   counties: [["39", "035"]] },
  "milwaukee":     { slugPrefix: "mke-",   counties: [["55", "079"]] },
  "las-vegas":     { slugPrefix: "lv-",    counties: [["32", "003"]] },
  "boise":         { slugPrefix: "bzi-",   counties: [["16", "001"]] },
  "buffalo":       { slugPrefix: "buf-",   counties: [["36", "029"]] },
  "norfolk":       { slugPrefix: "nor-",   counties: [["51", "710"]] },
  "kansas-city":   { slugPrefix: "kc-",    counties: [["29", "095"]] },
  "saint-paul":    { slugPrefix: "sp-",    counties: [["27", "123"]] },
  "pittsburgh":    { slugPrefix: "pgh-",   counties: [["42", "003"]] },
  "phoenix":       { slugPrefix: "phx-",   counties: [["04", "013"]] },
};

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/// Census Reporter takes a list of GEOIDs (prefixed "14000US" for
/// summary level 140 = census tract) and returns ACS estimates. We
/// already have the GEOIDs from TigerWeb, so this is a separate call
/// after the centroid fetch — no longer "one API call per county".
/// Batches to keep URL length manageable.
async function fetchTractPops(geoids) {
  const out = new Map();
  if (geoids.length === 0) return out;
  for (let i = 0; i < geoids.length; i += CENSUS_REPORTER_BATCH) {
    const batch = geoids.slice(i, i + CENSUS_REPORTER_BATCH);
    const prefixed = batch.map((g) => `14000US${g}`).join(",");
    const url = `https://api.censusreporter.org/1.0/data/show/latest?table_ids=B01003&geo_ids=${prefixed}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`CensusReporter ${res.status} (batch ${i}/${geoids.length})`);
    const data = await res.json();
    if (data.error) throw new Error(`CensusReporter: ${data.error}`);
    for (const [prefixedGeoid, payload] of Object.entries(data.data ?? {})) {
      const geoid = prefixedGeoid.replace(/^14000US/, "");
      const pop = payload?.B01003?.estimate?.B01003001;
      if (Number.isFinite(pop) && pop >= 0) out.set(geoid, pop);
    }
  }
  return out;
}

/// TigerWeb returns tract centroids with INTPTLAT/INTPTLON. We don't
/// need the full geometry — just the representative point so we can do
/// centroid-in-polygon. Returns Map<GEOID, {lat, lng}>.
async function fetchTractCentroids(state, county) {
  const where = encodeURIComponent(`STATE='${state}' AND COUNTY='${county}'`);
  const url = `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query?where=${where}&outFields=GEOID,INTPTLAT,INTPTLON&f=json&returnGeometry=false`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`TigerWeb ${res.status} for ${state}/${county}`);
  const data = await res.json();
  const out = new Map();
  for (const f of (data.features ?? [])) {
    const a = f.attributes;
    const lat = parseFloat(a.INTPTLAT);
    const lng = parseFloat(a.INTPTLON);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.set(a.GEOID, { lat, lng });
  }
  return out;
}

/// Standard ray-casting point-in-polygon. `ring` is [[lng, lat], ...].
function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-30) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/// A feature can be Polygon (one outer ring + optional holes) or
/// MultiPolygon (array of polygons). We treat a point as inside the
/// feature if it's inside ANY outer ring of any polygon. We don't
/// subtract holes — for tract centroid lookups the bias is negligible
/// (holes are usually water or parks with no tracts).
function pointInFeature(point, feature) {
  const g = feature.geometry;
  if (!g) return false;
  if (g.type === "Polygon") {
    return pointInRing(point, g.coordinates[0]);
  }
  if (g.type === "MultiPolygon") {
    for (const poly of g.coordinates) {
      if (pointInRing(point, poly[0])) return true;
    }
  }
  return false;
}

/// Haversine distance in km. Used for nearest-tract fallback.
function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function featureCentroid(feature) {
  // Average all outer-ring vertices. Good enough for picking a nearest
  // tract — we don't need a geometrically-exact centroid.
  const g = feature.geometry;
  let lat = 0, lng = 0, n = 0;
  function walk(coords) {
    for (const [x, y] of coords) { lng += x; lat += y; n++; }
  }
  if (g.type === "Polygon") walk(g.coordinates[0]);
  else if (g.type === "MultiPolygon") for (const p of g.coordinates) walk(p[0]);
  if (n === 0) return null;
  return { lat: lat / n, lng: lng / n };
}

async function processCity(citySlug, cfg) {
  const geoPath = path.join(GEO_DIR, `${citySlug}.geojson`);
  let geo;
  try {
    geo = JSON.parse(await fs.readFile(geoPath, "utf-8"));
  } catch {
    return { citySlug, ok: false, reason: "no_geojson" };
  }

  // Per county: get tract centroids from TigerWeb, then pop for those
  // GEOIDs from Census Reporter. Run counties in parallel — most cities
  // have one county; NYC has five and benefits from the fan-out.
  const tractData = await Promise.all(cfg.counties.map(async ([state, county]) => {
    const centroids = await fetchTractCentroids(state, county);
    const pops = await fetchTractPops(Array.from(centroids.keys()));
    return { state, county, pops, centroids };
  }));

  // Flatten into a single list of {geoid, lat, lng, pop} the spatial
  // join can iterate over.
  const tracts = [];
  for (const { pops, centroids } of tractData) {
    for (const [geoid, centroid] of centroids) {
      const pop = pops.get(geoid);
      if (pop != null && pop > 0) tracts.push({ geoid, ...centroid, pop });
    }
  }

  // For each polygon, sum populations of every tract whose centroid
  // falls inside. Polygons with zero matches fall back to nearest-
  // tract by haversine + a polygon-area-proportional scale.
  const populations = {}; // slug → pop
  let withMatches = 0, withFallback = 0;
  for (const feat of geo.features) {
    const name = feat.properties?.name;
    if (!name) continue;
    let pop = 0;
    for (const t of tracts) {
      if (pointInFeature([t.lng, t.lat], feat)) pop += t.pop;
    }
    if (pop > 0) {
      withMatches++;
    } else {
      // Fallback: nearest tract centroid by haversine, scaled by the
      // ratio of polygon area to a typical tract footprint. For now
      // use just the nearest tract's pop as the floor — small dense
      // polygons (downtowns) usually have at least one tract overlap
      // even when the centroid falls just outside.
      const c = featureCentroid(feat);
      if (c && tracts.length > 0) {
        let best = null;
        for (const t of tracts) {
          const km = haversineKm(c, t);
          if (!best || km < best.km) best = { t, km };
        }
        if (best && best.km < 10) {
          pop = best.t.pop;
          withFallback++;
        }
      }
    }
    if (pop > 0) {
      const slug = cfg.slugPrefix + slugify(name);
      // Several precincts can map to the same display label (NYC's
      // 79th+81st both → Bedford-Stuyvesant in our remap), so the
      // discovery aggregator collapses them by name. Reflect that by
      // ADDING populations across same-slug polygons.
      populations[slug] = (populations[slug] ?? 0) + pop;
    }
  }
  return {
    citySlug,
    ok: true,
    polygons: geo.features.length,
    withMatches,
    withFallback,
    skipped: geo.features.length - withMatches - withFallback,
    populations,
  };
}

async function main() {
  const summary = [];
  const allPops = {};

  // Process cities one at a time. Census API is forgiving but we
  // don't want to thrash TigerWeb when there's no payoff to running
  // 30 in parallel.
  for (const [citySlug, cfg] of Object.entries(CITY_CONFIG)) {
    process.stdout.write(`${citySlug.padEnd(18)} ... `);
    try {
      const r = await processCity(citySlug, cfg);
      if (!r.ok) {
        console.log(`SKIP (${r.reason})`);
        summary.push({ citySlug, ok: false, reason: r.reason });
        continue;
      }
      console.log(
        `${Object.keys(r.populations).length} pops ` +
        `(${r.withMatches} matched, ${r.withFallback} fallback, ${r.skipped} skipped)`,
      );
      summary.push(r);
      allPops[citySlug] = r.populations;
    } catch (err) {
      console.log(`ERR ${err.message}`);
      summary.push({ citySlug, ok: false, reason: err.message });
    }
  }

  // Emit a deterministic, alphabetically-sorted TS file.
  const sortedCities = Object.keys(allPops).sort();
  const lines = [
    `// AUTO-GENERATED by tools/build-neighborhood-populations.mjs`,
    `// Source: Census Reporter (latest ACS 5-year) table B01003 +`,
    `// TigerWeb tract centroids. Spatial join: centroid-in-polygon`,
    `// with nearest-tract fallback for polygons that capture no tract`,
    `// centroids (tiny downtown polygons where the centroid falls`,
    `// just outside).`,
    `//`,
    `// DO NOT EDIT BY HAND. Re-run the build script after new ACS`,
    `// releases or when adding a city. Manual overrides for specific`,
    `// neighborhoods live in neighborhood-population.ts and take`,
    `// precedence over this generated table.`,
    ``,
    `export const GENERATED_NEIGHBORHOOD_POPS: Record<string, Record<string, number>> = {`,
  ];
  for (const citySlug of sortedCities) {
    lines.push(`  ${JSON.stringify(citySlug)}: {`);
    const cityPops = allPops[citySlug];
    const slugs = Object.keys(cityPops).sort();
    for (const slug of slugs) {
      lines.push(`    ${JSON.stringify(slug)}: ${cityPops[slug]},`);
    }
    lines.push(`  },`);
  }
  lines.push(`};`);
  lines.push(``);

  await fs.writeFile(OUTPUT_PATH, lines.join("\n"));
  console.log(`\nWrote ${OUTPUT_PATH}`);

  // Print a summary table to stderr so it's visible even when stdout
  // is redirected.
  console.error("\nSummary:");
  for (const s of summary) {
    if (!s.ok) {
      console.error(`  ${s.citySlug.padEnd(18)} ✗ ${s.reason}`);
      continue;
    }
    const cov = s.polygons > 0 ? Math.round(((s.withMatches + s.withFallback) / s.polygons) * 100) : 0;
    console.error(
      `  ${s.citySlug.padEnd(18)} ${cov}% coverage ` +
      `(${Object.keys(s.populations).length} unique slugs)`,
    );
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
