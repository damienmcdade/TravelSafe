// v89 — shared User-Agent so every adapter identifies itself uniformly
// to upstream open-data portals (Socrata, ArcGIS, CKAN). Several portals
// rate-limit anonymous traffic differently from identified traffic.
export const USER_AGENT = "CommunitySafe/0.1 (https://github.com/damienmcdade/CommunitySafe)";

// v89 — Socrata X-App-Token lookup. Anonymous SoQL queries share a
// global throttle pool; adding an app token moves the calling app
// into a per-app pool with much higher limits.
//
// v93p4 — token signup process changed when Tyler Technologies
// acquired Socrata and rebranded to "Tyler Data & Insights". The
// old central portal at opendata.socrata.com is DEPRECATED — that
// SSO + federated-signup path no longer works. Tokens are now
// minted per-portal: create an account on each city's data portal
// (e.g. https://data.cityofnewyork.us/signup) then go to
// `Profile → Developer Settings` and click "Create New App Token".
//
// Operator-notes section "Socrata tokens" lists the working
// per-host signup URLs.
//
// Per-host env vars take precedence over the generic SOCRATA_APP_TOKEN
// so an operator can grant different tokens to different cities (or
// only some cities). Lookup order for `data.cityofnewyork.us`:
//   SOCRATA_APP_TOKEN_DATA_CITYOFNEWYORK_US > SOCRATA_APP_TOKEN
export function socrataAppToken(host: string): string | undefined {
  const k = "SOCRATA_APP_TOKEN_" + host.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return process.env[k] || process.env.SOCRATA_APP_TOKEN;
}

// Convenience: build the headers most Socrata adapters use, with
// X-App-Token attached automatically when a token is configured.
// Caller may pass a base headers object to extend.
export function socrataHeaders(url: string | URL, extra: Record<string, string> = {}): Record<string, string> {
  const host = typeof url === "string" ? new URL(url).host : url.host;
  const tok = socrataAppToken(host);
  const h: Record<string, string> = { Accept: "application/json", "User-Agent": USER_AGENT, ...extra };
  if (tok) h["X-App-Token"] = tok;
  return h;
}

// v90p4 — installPooledDispatcher REMOVED from this package.
// It lived here briefly in v87-v90p3 but undici's node: scheme
// imports (node:fs, node:dns, node:diagnostics_channel) crashed
// the Vercel webpack bundle even with dynamic import (webpack's
// static analyzer still saw the import("undici") string and
// tried to resolve it). The dispatcher is now installed
// directly in apps/api/src/index.ts which is Node-only.
// Vercel never reaches this path; routes proxy to Railway.
