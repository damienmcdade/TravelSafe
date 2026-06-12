#!/usr/bin/env node
// Frontend ↔ Backend sync drift detector.
//
// Why this exists: Vercel routes (/api/...) and Railway routes (/...)
// serve the SAME data through DIFFERENT codepaths. The web app's
// proxy-to-Railway helper (tryProxy) means a route can silently start
// returning Railway's response shape instead of its local one. When
// the two sides drift (different keys, different counts, different
// status codes for the same query), users see broken UI before any
// test in either repo catches it.
//
// Repro of the gap this caught: 2026-05-25 /geo/areas?city=new-york
// returned a 78-item dict from Vercel and a 7-item array of SD areas
// from Railway. Vercel proxied to Railway → wheel showed 7 SD areas
// for every non-SD city. The Express adapter was the SD-only legacy.
//
// Usage:
//   node tools/sync-check.mjs              # report-only, exit 0
//   node tools/sync-check.mjs --strict     # exit 1 on any drift
//   node tools/sync-check.mjs --json       # machine-readable
//
// Wired into .github/workflows/sync-check.yml on every PR + nightly.

import process from "node:process";

const VERCEL_BASE = process.env.SYNC_VERCEL_BASE || "https://communitysafe.app";
const RAILWAY_BASE = process.env.SYNC_RAILWAY_BASE || "https://communitysafe-api-production.up.railway.app";

const STRICT = process.argv.includes("--strict");
const JSON_OUT = process.argv.includes("--json");

// Canonical probes. Each tuple is:
//   [label, vercel_path, railway_path, shape_check]
//
// shape_check: function(vercelJson, railwayJson) → array of drift strings
// (empty array = perfect parity). Keep these intentionally simple so
// false positives are rare and the signal stays loud.
const PROBES = [
  ["geo/areas city=new-york",
    "/api/geo/areas?city=new-york",
    "/geo/areas?city=new-york",
    (v, r) => {
      const drift = [];
      const vShape = typeof v === "object" && !Array.isArray(v) ? "dict" : Array.isArray(v) ? "array" : typeof v;
      const rShape = typeof r === "object" && !Array.isArray(r) ? "dict" : Array.isArray(r) ? "array" : typeof r;
      if (vShape !== rShape) drift.push(`shape mismatch: vercel=${vShape} railway=${rShape}`);
      const vLen = vShape === "dict" ? (v.areas?.length ?? 0) : (Array.isArray(v) ? v.length : 0);
      const rLen = rShape === "dict" ? (r.areas?.length ?? 0) : (Array.isArray(r) ? r.length : 0);
      // Allow ±5% adapter-cache drift; flag bigger gaps.
      if (Math.abs(vLen - rLen) > Math.max(2, Math.ceil(vLen * 0.05))) {
        drift.push(`area count drift: vercel=${vLen} railway=${rLen}`);
      }
      return drift;
    }],

  ["crime-data/citywide city=detroit",
    "/api/crime-data/citywide?city=detroit",
    "/crime-data/citywide?city=detroit",
    (v, r) => keyParityCheck(v, r, "citywide.detroit") .concat(numParityCheck(v.totalIncidents, r.totalIncidents, "totalIncidents", 0.05))],

  ["crime-data/area-stats city=new-york",
    "/api/crime-data/area-stats?city=new-york",
    "/crime-data/area-stats?city=new-york",
    (v, r) => keyParityCheck(v, r, "area-stats.new-york")],

  ["safezone/safety-score city=new-york",
    "/api/safezone/safety-score?city=new-york",
    "/safezone/safety-score?city=new-york",
    (v, r) => {
      const drift = keyParityCheck(v, r, "safety-score.new-york");
      drift.push(...numParityCheck(v.windowDays, r.windowDays, "windowDays", 0.05));
      const vRows = (v.rows ?? []).reduce((acc, row) => ({ ...acc, [row.category]: row.count }), {});
      const rRows = (r.rows ?? []).reduce((acc, row) => ({ ...acc, [row.category]: row.count }), {});
      for (const cat of new Set([...Object.keys(vRows), ...Object.keys(rRows)])) {
        drift.push(...numParityCheck(vRows[cat], rRows[cat], `rows.${cat}.count`, 0.05));
      }
      return drift;
    }],

  ["safezone/trend city=new-york",
    "/api/safezone/trend?city=new-york&days=30",
    "/safezone/trend?city=new-york&days=30",
    (v, r) => keyParityCheck(v, r, "trend.new-york")],

  ["crime-data/insights city=new-york",
    "/api/crime-data/insights?city=new-york",
    "/crime-data/insights?city=new-york",
    (v, r) => keyParityCheck(v, r, "insights.new-york")],

  ["crime-data/mix city=new-york",
    "/api/crime-data/mix?city=new-york",
    "/crime-data/mix?city=new-york",
    (v, r) => keyParityCheck(v, r, "mix.new-york")],

  ["crime-data/upticks city=new-york",
    "/api/crime-data/upticks?city=new-york",
    "/crime-data/upticks?city=new-york",
    (v, r) => keyParityCheck(v, r, "upticks.new-york")],

  // Deploy-version coherence — the ROOT cause of data drift is the two sides
  // running different code: Vercel auto-deploys on push, Railway does NOT
  // (unless the RAILWAY_TOKEN secret is set for CI), so until someone redeploys
  // the API the proxied responses come from older
  // adapter logic. Compare the deployed git SHAs directly (web /api/health
  // `commit` vs Railway /health `commit`/`buildSha`) so skew is caught even
  // before it manifests as a data-shape difference.
  ["deploy version coherence (web vs railway git SHA)",
    "/api/health",
    "/health",
    (v, r) => {
      const vSha = (v && v.commit) || null;
      const rSha = (r && (r.commit || r.buildSha)) || null;
      if (!vSha || !rSha) return []; // can't compare (local/unknown env) — not drift
      if (vSha !== rSha) {
        // Recommend the SHA-stamping wrapper, NOT bare `railway up`: a bare
        // CLI upload never updates GIT_COMMIT_SHA, so /health keeps reporting
        // the old SHA and this probe stays red even after the code ships.
        return [`DEPLOY SKEW: vercel=${vSha} railway=${rSha} — the two run different code; redeploy the lagging side (\`bash tools/deploy-railway.sh\` for the API; a bare \`railway up\` leaves GIT_COMMIT_SHA stale and this probe stays red).`];
      }
      return [];
    }],
];

function keyParityCheck(v, r, label) {
  const drift = [];
  if (v == null || r == null) {
    drift.push(`${label}: one side null (vercel=${v == null}, railway=${r == null})`);
    return drift;
  }
  if (typeof v !== typeof r) {
    drift.push(`${label}: type mismatch vercel=${typeof v} railway=${typeof r}`);
    return drift;
  }
  if (typeof v !== "object" || Array.isArray(v)) return drift;
  const vk = Object.keys(v).sort();
  const rk = Object.keys(r).sort();
  const vMissing = vk.filter((k) => !rk.includes(k));
  const rMissing = rk.filter((k) => !vk.includes(k));
  if (vMissing.length > 0) drift.push(`${label}: railway missing keys: ${vMissing.join(",")}`);
  if (rMissing.length > 0) drift.push(`${label}: vercel missing keys: ${rMissing.join(",")}`);
  return drift;
}

function numParityCheck(v, r, label, tolerance) {
  if (v == null && r == null) return [];
  if (v == null || r == null) return [`${label}: one side null (vercel=${v}, railway=${r})`];
  if (typeof v !== "number" || typeof r !== "number") return [];
  if (v === 0 && r === 0) return [];
  const diff = Math.abs(v - r);
  const base = Math.max(Math.abs(v), Math.abs(r), 1);
  if (diff / base > tolerance) return [`${label}: drift vercel=${v} railway=${r} (${((diff / base) * 100).toFixed(1)}% > ${tolerance * 100}%)`];
  return [];
}

async function fetchJson(base, path) {
  const url = `${base}${path}`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "CommunitySafe-sync-check/1.0" },
      signal: ctrl.signal,
    });
    const text = await res.text();
    try {
      return { ok: res.ok, status: res.status, body: JSON.parse(text) };
    } catch {
      return { ok: false, status: res.status, body: null, text: text.slice(0, 200) };
    }
  } catch (err) {
    return { ok: false, status: 0, body: null, error: err.message };
  } finally {
    clearTimeout(to);
  }
}

// v95p41 — retry-once on transient failures, and re-classify
// "both-sides-agree-on-non-2xx" as UPSTREAM (not drift). The whole
// point of this check is to detect *divergence* between Vercel and
// Railway. When both sides return the same 503 because the upstream
// city ArcGIS is slow, that's an upstream signal — flagging it as
// drift made the workflow misleadingly red even after my v95p39 fix
// added a graceful 503 to /crime-data/citywide.
async function probeWithRetry(base, path) {
  let r = await fetchJson(base, path);
  if (!r.ok && r.status === 0) {
    // Transient fetch failure (timeout / network blip). One retry
    // after a short backoff catches the common case where Railway
    // was warming up.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    r = await fetchJson(base, path);
  }
  return r;
}

const report = [];
let driftCount = 0;
let upstreamCount = 0;
for (const [label, vPath, rPath, check] of PROBES) {
  const [v, r] = await Promise.all([
    probeWithRetry(VERCEL_BASE, vPath),
    probeWithRetry(RAILWAY_BASE, rPath),
  ]);
  const entry = {
    label,
    vercel: { path: vPath, status: v.status },
    railway: { path: rPath, status: r.status },
    drift: [],
    classification: "ok",
  };

  if (v.status !== r.status) {
    entry.drift.push(`status mismatch: vercel=${v.status} railway=${r.status}`);
    entry.classification = "drift";
  }
  if (v.ok && r.ok && v.body && r.body) {
    const shapeDrift = check(v.body, r.body);
    if (shapeDrift.length > 0) entry.classification = "drift";
    entry.drift.push(...shapeDrift);
  } else if (!v.ok && !r.ok && v.status === r.status) {
    // Both sides equally non-2xx and statuses agree → upstream issue,
    // NOT a frontend↔backend sync drift. Annotate so it surfaces in
    // the report but doesn't fail strict mode.
    entry.drift.push(
      `upstream: both sides returned ${v.status} (treated as not-drift; ` +
        `frontend and backend agree on the upstream's current state)`,
    );
    entry.classification = "upstream";
  } else if (!v.ok || !r.ok) {
    entry.drift.push(`one side returned non-2xx (vercel ok=${v.ok}, railway ok=${r.ok})`);
    entry.classification = "drift";
  }
  if (entry.classification === "drift") driftCount++;
  if (entry.classification === "upstream") upstreamCount++;
  report.push(entry);
}

if (JSON_OUT) {
  console.log(JSON.stringify({ probes: report.length, driftCount, upstreamCount, report }, null, 2));
} else {
  for (const e of report) {
    const marker =
      e.classification === "drift" ? "DRIFT"
      : e.classification === "upstream" ? "UPSTREAM"
      : "OK";
    console.log(`[${marker}] ${e.label}  vercel=${e.vercel.status}  railway=${e.railway.status}`);
    for (const d of e.drift) console.log(`   • ${d}`);
  }
  console.log(
    `\n${driftCount}/${report.length} probes drifted` +
      (upstreamCount > 0 ? ` (${upstreamCount} upstream-only, not counted)` : "") +
      ".",
  );
}

if (STRICT && driftCount > 0) process.exit(1);
