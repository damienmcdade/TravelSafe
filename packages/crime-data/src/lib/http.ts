// v89 — shared User-Agent so every adapter identifies itself uniformly
// to upstream open-data portals (Socrata, ArcGIS, CKAN). Several portals
// rate-limit anonymous traffic differently from identified traffic.
export const USER_AGENT = "CommunitySafe/0.1 (https://github.com/damienmcdade/TravelSafe)";

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

// v96p2 — Socrata's floating_timestamp datatype rejects the standard
// `Date#toISOString()` output because of the trailing
// `.NNNZ` (millisecond + zone) suffix — the parser only accepts
// `YYYY-MM-DDTHH:MM:SS` form. Several adapters that added recent
// `$where` clauses to bound their pulls were getting HTTP 400 on
// the resulting URL. Single helper so the strip is consistent.
export function socrataDate(d: Date | number): string {
  const ms = typeof d === "number" ? d : d.getTime();
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "");
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
  /// v96p2 — declarative recent-window filter. When set, fetchSocrata
  /// automatically appends `${dateField} >= '<cutoff>'` to the where
  /// clause (AND'd if `where` is also set). 11 adapters previously
  /// hand-rolled the same socrataDate(Date.now() - N days) +
  /// $where string-template; pushing the pattern down here keeps
  /// the intent declarative (caller says "180 days of incident_date")
  /// and means a future window-size change is a single-line edit.
  windowDays?: number;
  /// Date column to apply `windowDays` against. Required when
  /// `windowDays` is set. Empty/missing → no auto window.
  dateField?: string;
  /// $order clause (e.g., "cmplnt_fr_dt DESC").
  order?: string;
  /// $limit (caps at 50,000 per Socrata's hard ceiling).
  limit?: number;
  /// $offset for pagination.
  offset?: number;
  /// Per-call AbortSignal (defaults to AbortSignal.timeout(45s)).
  /// v96p2 — bumped default 30s → 45s after Vercel build prerender
  /// kept tripping the abort on SF/NOLA/Dallas. 30s wasn't enough
  /// margin against Socrata's slow path; 45s sits comfortably under
  /// the platform's 60s function ceiling.
  signal?: AbortSignal;
}

// v108 — upstream returned a body that is NOT JSON. Open-data portals
// (Esri ArcGIS, Socrata, CKAN, Carto) and the CDNs / WAFs in front of
// them frequently answer a 200 OR a 5xx with an HTML or plain-text
// error page ("An error has occurred", a Cloudflare challenge, an nginx
// 502, a maintenance notice) instead of JSON. Calling res.json() on
// that throws a raw `SyntaxError: Unexpected identifier "An"` deep
// inside the adapter, which previously bubbled all the way to the
// client and was rendered verbatim to users. We classify it as a
// transient upstream failure so the shared retry path re-attempts, and
// — on final failure — the dispatcher falls back to last-known-good.
export class UpstreamNonJsonError extends Error {
  readonly transient = true;
  constructor(message: string) {
    super(message);
    this.name = "UpstreamNonJsonError";
  }
}

// v108 — single safe JSON reader for every adapter that fetches by hand
// (all the ArcGIS / CKAN / Carto / SANDAG adapters). Reads the body as
// text first, then parses inside a try/catch so a non-JSON error page
// becomes an UpstreamNonJsonError (with a short snippet for the log)
// instead of an uncaught SyntaxError. Returns the parsed value; callers
// keep their own `as <Shape>` cast and their own `body.error` envelope
// checks. Use this everywhere instead of `await res.json()`.
export async function readJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text || !text.trim()) {
    throw new UpstreamNonJsonError(`empty body from ${res.url || "upstream"} (HTTP ${res.status})`);
  }
  // Cheap pre-check: a JSON value can only start with { [ " digit - t f n.
  // An HTML/text error page starts with "<", "A", "U", etc. This lets us
  // produce a clear message without relying on the engine's parse error.
  const head = text.trimStart()[0];
  const looksJson = head === "{" || head === "[" || head === '"' || head === "-" || (head >= "0" && head <= "9")
    || text.trimStart().startsWith("true") || text.trimStart().startsWith("false") || text.trimStart().startsWith("null");
  if (!looksJson) {
    const snippet = text.slice(0, 120).replace(/\s+/g, " ").trim();
    throw new UpstreamNonJsonError(`non-JSON body from ${res.url || "upstream"} (HTTP ${res.status}): ${snippet}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const snippet = text.slice(0, 120).replace(/\s+/g, " ").trim();
    throw new UpstreamNonJsonError(`malformed JSON from ${res.url || "upstream"} (HTTP ${res.status}): ${snippet} — ${(err as Error).message}`);
  }
}

// v96p2 — retry classifier. The deployment-log scan kept turning up
// `fetch failed: fetch failed` lines that are undici-level transient
// network errors (DNS blip, TLS handshake reset, connection drop)
// rather than upstream-side parse errors or quota hits. They're
// invisible from inside fetch() but show up in `err.cause` as
// generic Error with messages like "fetch failed" or codes like
// ECONNRESET / UND_ERR_*. Distinguish from a real HTTP-level
// failure (which throws our own "<adapter> <status>" message) and
// from request abort (deliberate timeout — retrying is pointless).
function isTransientFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return false;
  // v108 — a non-JSON upstream error page is worth one quick retry: it's
  // very often a transient CDN/WAF 502/503 or a momentary maintenance
  // page that clears within a second or two.
  if (err instanceof UpstreamNonJsonError) return true;
  // undici wraps the underlying error in `.cause`. Match the codes
  // that empirically retry-successfully: connection-level failures
  // and DNS errors.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cause = (err as any).cause as { code?: string; message?: string } | undefined;
  if (cause?.code && /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|UND_ERR_)/i.test(cause.code)) {
    return true;
  }
  // Generic "fetch failed" with no useful body is the signature of
  // an undici socket-level failure we want to retry.
  return /fetch failed/i.test(err.message) || /fetch failed/i.test(cause?.message ?? "");
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// v96p2 — generic transient-retry wrapper for adapters that don't go
// through fetchSocrata (ArcGIS / CKAN / city-specific REST). Same
// classifier + backoff as the Socrata path. Callers pass the same
// fetch() invocation they were already using; the wrapper retries
// up to twice on undici-level network drops only.
export async function fetchWithRetry(
  input: URL | string,
  init?: RequestInit,
): Promise<Response> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      if (attempt < maxAttempts && isTransientFetchError(err)) {
        await sleep(250 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw new Error("fetchWithRetry exhausted retries");
}

// v96p2 — internal helper: build the final $where SoQL by AND-ing
// the caller's where with the optional auto-window cutoff. Returns
// undefined when both inputs are empty so the caller skips setting
// $where entirely.
function composeWhere(q: SocrataQuery): string | undefined {
  const userWhere = q.where?.trim() || "";
  const hasWindow = q.windowDays != null && q.windowDays > 0 && q.dateField;
  if (!userWhere && !hasWindow) return undefined;
  if (!hasWindow) return userWhere;
  const cutoff = socrataDate(Date.now() - q.windowDays! * 24 * 60 * 60 * 1000);
  const auto = `${q.dateField} >= '${cutoff}'`;
  return userWhere ? `(${userWhere}) AND ${auto}` : auto;
}

export async function fetchSocrata<TRow>(
  adapterName: string,
  query: SocrataQuery,
): Promise<TRow[]> {
  const url = typeof query.url === "string" ? new URL(query.url) : new URL(query.url.toString());
  if (query.select) url.searchParams.set("$select", query.select);
  // v96p2 — compose where with optional auto-window. When both
  // windowDays + dateField are set, append `${dateField} >= '<cutoff>'`
  // AND'd with the caller's where (if any) so adapters declare
  // `windowDays: 180, dateField: "incident_datetime"` instead of
  // hand-rolling the SoQL string + socrataDate call.
  const where = composeWhere(query);
  if (where) url.searchParams.set("$where", where);
  if (query.order) url.searchParams.set("$order", query.order);
  if (query.limit != null) url.searchParams.set("$limit", String(query.limit));
  if (query.offset != null) url.searchParams.set("$offset", String(query.offset));

  // v96p2 — retry transient network failures up to 2 extra times
  // with exponential backoff. The deployment-log scan kept showing
  // `[<adapter>] fetch failed: fetch failed` lines that were just
  // undici socket drops; a single quick retry silently recovers in
  // the vast majority of cases. HTTP 4xx/5xx are NOT retried (we
  // throw with the status code immediately so the caller sees the
  // real upstream signal).
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: socrataHeaders(url),
        signal: query.signal ?? AbortSignal.timeout(45_000),
      });
      if (!res.ok) {
        throw new Error(`${adapterName} ${res.status} ${url}`);
      }
      // v108 — safe parse: a 200 with an HTML/text error page (seen from
      // Socrata's CDN during incidents) no longer throws a raw SyntaxError;
      // readJson raises an UpstreamNonJsonError which retries here, then
      // surfaces cleanly so the dispatcher serves last-known-good.
      const body = await readJson<TRow[] | { error: true; message?: string }>(res);
      if (!Array.isArray(body)) {
        throw new Error(`${adapterName} error: ${("message" in body && body.message) || "unknown"}`);
      }
      return body;
    } catch (err) {
      if (attempt < maxAttempts && isTransientFetchError(err)) {
        await sleep(250 * attempt);  // 250 ms, 500 ms backoff
        continue;
      }
      throw err;
    }
  }
  // Unreachable — the loop either returns or throws — but TypeScript
  // wants an explicit fallthrough.
  throw new Error(`${adapterName} exhausted retries`);
}

// v90p4 — installPooledDispatcher REMOVED from this package.
// It lived here briefly in v87-v90p3 but undici's node: scheme
// imports (node:fs, node:dns, node:diagnostics_channel) crashed
// the Vercel webpack bundle even with dynamic import (webpack's
// static analyzer still saw the import("undici") string and
// tried to resolve it). The dispatcher is now installed
// directly in apps/api/src/index.ts which is Node-only.
// Vercel never reaches this path; routes proxy to Railway.
