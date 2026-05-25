#!/usr/bin/env node
// Regenerates apps/web/data/boston-snapshot.json from the live BPD CSV.
//
// Run: node tools/refresh-boston.mjs
// Then: git add apps/web/data/boston-snapshot.json && git commit
//
// Why this exists: data.boston.gov rejects Vercel's IP range for any
// non-trivial response. The CSV download endpoint redirects to a signed S3
// URL that DOES work from Vercel, but downloading + parsing 48 MB on every
// cold start is wasteful. Instead we snapshot the most-recent 5,000 rows
// here and ship them as static JSON in the bundle.
//
// Cadence: weekly is plenty (BPD publishes with ~1-month lag anyway).

import { mkdirSync, createWriteStream, createReadStream, statSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import readline from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
// v58 path update — boston-snapshot moved to the @travelsafe/crime-data
// workspace package during the v34 monorepo extraction. Writing to the
// old apps/web path created dead files while the live adapter kept
// loading the stale committed snapshot (3+ days lag observed in prod).
const OUT_JSON = resolve(REPO_ROOT, "packages/crime-data/src/data/boston-snapshot.json");
const OUT_PATH = resolve(REPO_ROOT, "packages/crime-data/src/data/boston-snapshot.ts");
const TMP_CSV = resolve(REPO_ROOT, ".cache/boston-full.csv");
const ROWS_TO_KEEP = 5000;
const CSV_URL = "https://data.boston.gov/dataset/6220d948-eae2-4e4b-8723-2dc8e67722a3/resource/b973d8cb-eeb2-4e7e-99da-c92938efc9c0/download/tmpcyl1hw5w.csv";

mkdirSync(dirname(TMP_CSV), { recursive: true });
mkdirSync(dirname(OUT_PATH), { recursive: true });

console.log(`Downloading Boston CSV …`);
const start = Date.now();
const res = await fetch(CSV_URL, {
  redirect: "follow",
  headers: { "User-Agent": "TravelSafe-refresh/1.0 (https://github.com/damienmcdade/TravelSafe)" },
});
if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
await pipeline(Readable.fromWeb(res.body), createWriteStream(TMP_CSV));
const sizeMB = (statSync(TMP_CSV).size / 1_048_576).toFixed(1);
console.log(`Downloaded ${sizeMB} MB in ${((Date.now()-start)/1000).toFixed(1)}s`);

console.log(`Parsing + filtering to most-recent ${ROWS_TO_KEEP} rows …`);
// v58 — quote-aware CSV parser. The prior naive line.split(",")
// shifted column indexes whenever OFFENSE_DESCRIPTION contained
// internal commas (e.g. "ANIMAL INCIDENTS (DOG BITES, LOST DOG, ETC)"),
// which collapsed the snapshot from ~5k rows to ~800 garbage rows
// with OCCURRED_ON_DATE = "47" etc. The fix is to handle the BPD
// CSV's standard RFC-4180-ish quoting.
function splitCSV(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const rl = readline.createInterface({ input: createReadStream(TMP_CSV), crlfDelay: Infinity });
let headers = null;
const idx = {};
const rows = [];
for await (const line of rl) {
  if (!headers) {
    headers = splitCSV(line);
    for (const [i, h] of headers.entries()) idx[h] = i;
    continue;
  }
  const f = splitCSV(line);
  const date_str = f[idx.OCCURRED_ON_DATE];
  if (!date_str) continue;
  // BPD timestamps land as "2023-01-27 22:44:00+00" (no colon in
  // offset, two-digit hour only). Node's Date.parse rejects "+00" —
  // normalize to "+00:00" so the timestamp parses to a finite number.
  const iso = date_str.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) continue;
  rows.push({
    ts,
    INCIDENT_NUMBER: f[idx.INCIDENT_NUMBER] || "",
    OFFENSE_DESCRIPTION: (f[idx.OFFENSE_DESCRIPTION] || "").trim(),
    DISTRICT: f[idx.DISTRICT] || "",
    OCCURRED_ON_DATE: date_str,
    Lat: f[idx.Lat] || null,
    Long: f[idx.Long] || null,
  });
}
rows.sort((a, b) => b.ts - a.ts);
const top = rows.slice(0, ROWS_TO_KEEP).map(({ ts: _ts, ...rest }) => rest);

const snapshot = {
  generated_at: new Date().toISOString(),
  source: "https://data.boston.gov/dataset/crime-incident-reports-august-2015-to-date-source-new-system",
  count: top.length,
  newest: top[0]?.OCCURRED_ON_DATE ?? null,
  oldest: top[top.length - 1]?.OCCURRED_ON_DATE ?? null,
  rows: top,
};
// Write both forms:
//  * JSON (for quick eyeballing, diff-friendly)
//  * TS module (the actual import target — bundled by Next reliably)
writeFileSync(OUT_JSON, JSON.stringify(snapshot));
const tsBody = `// Auto-generated by tools/refresh-boston.mjs — do not edit by hand.
// Bundled as a TS module (not JSON) so Next file-tracing always includes it.

export interface BostonSnapshotRow {
  INCIDENT_NUMBER: string;
  OFFENSE_DESCRIPTION: string;
  DISTRICT: string;
  OCCURRED_ON_DATE: string;
  Lat: string | null;
  Long: string | null;
}

export interface BostonSnapshot {
  generated_at: string;
  source: string;
  count: number;
  newest: string | null;
  oldest: string | null;
  rows: BostonSnapshotRow[];
}

export const bostonSnapshot: BostonSnapshot = ${JSON.stringify(snapshot)};
`;
writeFileSync(OUT_PATH, tsBody);
try { unlinkSync(TMP_CSV); } catch {}
const outSize = (statSync(OUT_PATH).size / 1024).toFixed(0);
console.log(`Wrote ${OUT_PATH} (${outSize} KB · ${top.length} rows)`);
console.log(`  newest: ${snapshot.newest}`);
console.log(`  oldest: ${snapshot.oldest}`);
console.log(`Done. Commit the snapshot to ship it.`);
