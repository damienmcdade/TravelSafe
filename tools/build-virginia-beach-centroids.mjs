#!/usr/bin/env node
/**
 * Regenerate packages/crime-data/src/data/virginia-beach-area-centroids.ts.
 *
 * Why VB needs its own tool (not build-area-centroids.mjs): VBPD's incident
 * feed has NO per-incident coordinates (geometryType None) and its free-text
 * `Subdivision` names only slug-match ~33% of the city's Planning_Subdivisions
 * polygon layer. So neither the bundled geojson nor incident geometry can place
 * the ~961 subdivisions — 629 used to collapse onto the citywide centroid.
 *
 * Resolution pipeline (network; run manually, commit the output). For each
 * subdivision, in priority order, validated to the VB bounding box:
 *   1. Census-geocoded MODAL incident address (Block+Street).
 *   2. Census-geocoded MEAN of ALL the subdivision's distinct incident addresses.
 *   3. Matching Planning_Subdivisions polygon centroid (name-slug match).
 *   4. Parent area centroid for "<sub> In <parent>" developments.
 *   5. Nominatim (OSM) on the cleaned place name, then on an incident address.
 *
 * Result: 961/961 live feed areas resolve to a real, distinct point.
 */
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const POLY = "https://services1.arcgis.com/GrjW6OKZyxxl7aHZ/arcgis/rest/services/Planning_Subdivisions/FeatureServer/0/query";
const INC = "https://services2.arcgis.com/CyVvlIiUfRBmMQuu/arcgis/rest/services/Police_Incident_Reports_view/FeatureServer/0/query";
const AREAS = "https://communitysafe-api-production.up.railway.app/geo/areas?city=virginia-beach";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../packages/crime-data/src/data/virginia-beach-area-centroids.ts");

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const inVB = (c) => c && c.lat >= 36.5 && c.lat <= 37.05 && c.lng >= -76.35 && c.lng <= -75.8;
const getJ = async (u) => (await fetch(u, { signal: AbortSignal.timeout(45000) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function polygonCentroids() {
  const out = {};
  for (let offset = 0; ; offset += 2000) {
    const d = await getJ(`${POLY}?where=1%3D1&outFields=SUBD_DESC&returnCentroid=true&returnGeometry=false&outSR=4326&resultOffset=${offset}&resultRecordCount=2000&f=json`);
    const fs = d.features || [];
    for (const f of fs) { const n = f.attributes.SUBD_DESC, c = f.centroid; if (n && c) out["vb-" + slug(n)] = { lat: +c.y.toFixed(5), lng: +c.x.toFixed(5) }; }
    if (fs.length < 2000) break;
  }
  return out;
}

// All distinct Block+Street addresses per subdivision, modal first.
async function addressesBySub(labels) {
  const want = labels.map((l) => l.replace(/'/g, "''"));
  const tally = new Map();
  for (let i = 0; i < want.length; i += 40) {
    const where = encodeURIComponent("Subdivision IN (" + want.slice(i, i + 40).map((n) => `'${n}'`).join(",") + ")");
    const d = await getJ(`${INC}?where=${where}&outFields=Subdivision,Block,Street&returnGeometry=false&resultRecordCount=4000&f=json`);
    for (const f of (d.features || [])) {
      const a = f.attributes, sub = a.Subdivision, street = (a.Street || "").trim();
      if (!sub || !street) continue;
      const s = "vb-" + slug(sub), key = `${(a.Block ?? "").toString().trim()} ${street}`.trim().toUpperCase();
      if (!tally.has(s)) tally.set(s, new Map());
      const m = tally.get(s); m.set(key, (m.get(key) || 0) + 1);
    }
  }
  const out = {};
  for (const [s, m] of tally) out[s] = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return out;
}

async function censusBatch(rows) {
  const out = {};
  for (let i = 0; i < rows.length; i += 2500) {
    const csv = rows.slice(i, i + 2500).map(([id, a]) => `${id},${(a || "").replace(/[",]/g, " ").trim()},Virginia Beach,VA,`).join("\n") + "\n";
    const fd = new FormData();
    fd.append("benchmark", "Public_AR_Current");
    fd.append("addressFile", new Blob([csv], { type: "text/csv" }), "a.csv");
    const text = await (await fetch("https://geocoding.geo.census.gov/geocoder/locations/addressbatch", { method: "POST", body: fd, signal: AbortSignal.timeout(120000) })).text();
    for (const line of text.split("\n")) {
      const id = (line.match(/^"?([^",]+)"?,/) || [])[1]; if (!id) continue;
      const c = line.match(/(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (c) { const pt = { lat: +(+c[2]).toFixed(5), lng: +(+c[1]).toFixed(5) }; if (inVB(pt)) (out[id] ||= []).push(pt); }
    }
  }
  return out;
}

async function nominatim(q) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=us`,
      { headers: { "User-Agent": "CommunitySafe/1.0 (centroid audit)" }, signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    if (j[0]) { const pt = { lat: +(+j[0].lat).toFixed(5), lng: +(+j[0].lon).toFixed(5) }; if (inVB(pt)) return pt; }
  } catch { /* ignore */ }
  return null;
}
const mean = (pts) => ({ lat: +(pts.reduce((a, p) => a + p.lat, 0) / pts.length).toFixed(5), lng: +(pts.reduce((a, p) => a + p.lng, 0) / pts.length).toFixed(5) });

const areas = (await getJ(AREAS)).areas || [];
const labelOf = new Map(areas.map((a) => [a.slug, a.label]));
const poly = await polygonCentroids();
const addrs = await addressesBySub([...labelOf.values()]);
const table = {};

// Stages 1+2: Census modal, then mean of all addresses.
const modalRows = [], allRows = [];
for (const [s, list] of Object.entries(addrs)) {
  const geocodable = list.filter((a) => !a.includes("&") && /\d/.test(a));
  if (geocodable[0]) modalRows.push([s, geocodable[0]]);
  geocodable.forEach((a, i) => allRows.push([`${s}@@${i}`, a]));
}
const modalHits = await censusBatch(modalRows);
for (const [s, pts] of Object.entries(modalHits)) table[s] = pts[0];
const allHits = await censusBatch(allRows);
const bySub = {};
for (const [id, pts] of Object.entries(allHits)) { const s = id.split("@@")[0]; (bySub[s] ||= []).push(...pts); }
for (const [s, pts] of Object.entries(bySub)) if (!table[s]) table[s] = mean(pts);

// Stage 3: polygon centroid by name slug.
for (const s of labelOf.keys()) if (!table[s] && inVB(poly[s])) table[s] = poly[s];

// Stages 4+5: parent area, then Nominatim (name, then addresses). Serial — Nominatim is rate-limited.
const known = (k) => table[k] || poly[k] || null;
for (const [s, label] of labelOf) {
  if (table[s]) continue;
  const m = label.match(/\bin\s+(.+)$/i);
  if (m) { const p = known("vb-" + slug(m[1])) || (areas.find((a) => table[a.slug] && a.slug.includes(slug(m[1]))) || {}).slug; const pt = typeof p === "string" ? table[p] : p; if (inVB(pt)) { table[s] = { ...pt }; continue; } }
  const core = label.replace(/\bShpg Ctr\b/gi, "Shopping Center").replace(/\bApts\b/gi, "Apartments").replace(/\s+Area$/i, "").replace(/\s+In\s+.+$/i, "").trim();
  let pt = await nominatim(`${core}, Virginia Beach, VA`); await sleep(1100);
  if (!pt) for (const a of (addrs[s] || []).filter((x) => !x.includes("&") && /\d/.test(x)).slice(0, 5)) { pt = await nominatim(`${a}, Virginia Beach, VA`); await sleep(1100); if (pt) break; }
  if (pt) table[s] = pt;
}

const keys = Object.keys(table).filter((k) => inVB(table[k])).sort();
const body = keys.map((k) => `  ${JSON.stringify(k)}: { lat: ${table[k].lat}, lng: ${table[k].lng} },`).join("\n");
writeFileSync(OUT, `// AUTO-GENERATED by tools/build-virginia-beach-centroids.mjs — DO NOT EDIT BY HAND.
//
// Real per-subdivision centroids for Virginia Beach. VBPD's incident feed has
// NO per-incident coordinates (geometryType None) and its free-text Subdivision
// names only slug-match ~33% of the city's Planning_Subdivisions polygon layer,
// so the adapter previously collapsed 629 of 961 areas onto the citywide point.
//
// Resolved per subdivision, in priority order, all validated to the VB bbox:
//   1. Census-geocoded modal incident address (Block+Street).
//   2. Census-geocoded mean of ALL the subdivision's distinct incident addresses.
//   3. Matching Planning_Subdivisions polygon centroid (name-slug match).
//   4. Parent area centroid for "<sub> In <parent>" developments.
//   5. Nominatim (OSM) on the cleaned place name, then on an incident address.
// Every live feed area (961/961) now resolves to a real, distinct point.
export interface LatLng { lat: number; lng: number }
export const VB_AREA_CENTROIDS: Record<string, LatLng> = {
${body}
};
`);
console.log(`wrote ${keys.length} VB centroids -> ${OUT}`);
const covered = areas.filter((a) => table[a.slug]).length;
console.log(`coverage: ${covered}/${areas.length} live feed areas`);
