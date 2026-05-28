// v89 — shared User-Agent so every adapter identifies itself uniformly
// to upstream open-data portals (Socrata, ArcGIS, CKAN). Several portals
// rate-limit anonymous traffic differently from identified traffic.
export const USER_AGENT = "TravelSafe/0.1 (https://github.com/damienmcdade/TravelSafe)";

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

// v96 — shared Socrata fetch helper. Every Socrata adapter (currently
// 18+ files) opens with the same boilerplate: build URL with
// $select/$where/$order/$limit, fetch with socrataHeaders, check
// status, parse JSON, throw with a prefixed error message on failure.
// Extracting it here:
//   * lets adapters declare just the SoQL query + row mapping
//   * gives them a single source of truth for status-code handling
//     (4xx/5xx, empty body, JSON error envelope)
//   * makes upstream rate-limit response tweaks (e.g., honoring
//     Retry-After) a one-line change instead of an 18-file edit
//
// Adapters opt in by replacing their hand-rolled fetch with
// fetchSocrata(); they still own their own row → Incident mapping.
//
// Returns the raw row array. The caller decides the row shape (each
// adapter has its own slightly-different SodaRow interface). Throws
// with the supplied `name` prefix on any HTTP / JSON failure so the
// log line reads like the existing convention ("NYPD 500" / "SFPD
// 404").
export interface SocrataQuery {
  /// e.g. "https://data.cityofnewyork.us/resource/qgea-i56i.json"
  url: URL | string;
  /// Comma-separated $select. Optional — when omitted Socrata returns
  /// every column.
  select?: string;
  /// $where SoQL filter. Optional.
  where?: string;
  /// $order clause (e.g., "cmplnt_fr_dt DESC").
  order?: string;
  /// $limit (caps at 50,000 per Socrata's hard ceiling).
  limit?: number;
  /// $offset for pagination.
  offset?: number;
  /// Per-call AbortSignal (defaults to AbortSignal.timeout(30s)).
  signal?: AbortSignal;
}

export async function fetchSocrata<TRow>(
  adapterName: string,
  query: SocrataQuery,
): Promise<TRow[]> {
  const url = typeof query.url === "string" ? new URL(query.url) : new URL(query.url.toString());
  if (query.select) url.searchParams.set("$select", query.select);
  if (query.where) url.searchParams.set("$where", query.where);
  if (query.order) url.searchParams.set("$order", query.order);
  if (query.limit != null) url.searchParams.set("$limit", String(query.limit));
  if (query.offset != null) url.searchParams.set("$offset", String(query.offset));
  const res = await fetch(url, {
    headers: socrataHeaders(url),
    signal: query.signal ?? AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`${adapterName} ${res.status} ${url}`);
  }
  const body = await res.json() as TRow[] | { error: true; message?: string };
  if (!Array.isArray(body)) {
    throw new Error(`${adapterName} error: ${("message" in body && body.message) || "unknown"}`);
  }
  return body;
}

// v90p4 — installPooledDispatcher REMOVED from this package.
// It lived here briefly in v87-v90p3 but undici's node: scheme
// imports (node:fs, node:dns, node:diagnostics_channel) crashed
// the Vercel webpack bundle even with dynamic import (webpack's
// static analyzer still saw the import("undici") string and
// tried to resolve it). The dispatcher is now installed
// directly in apps/api/src/index.ts which is Node-only.
// Vercel never reaches this path; routes proxy to Railway.
