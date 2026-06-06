import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "@travelsafe/crime-data/errors";

// HttpError is now defined in @travelsafe/crime-data/errors so the
// scoring + dispatcher code (which lives in that package as of v35)
// can throw from a portable class. Re-exported here so existing
// callers still import from "@/server/lib/http".
export { HttpError };

/// Standard error response shape across all Route Handlers.
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    return NextResponse.json({ error: "validation_failed", issues: err.issues }, { status: 400 });
  }
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
  }
  // fix(audit malformed-body-500): a malformed/empty request body makes
  // `await req.json()` throw a SyntaxError, which is neither ZodError nor
  // HttpError — so it fell through to a misleading 500. A bad client body is a
  // 400. Centralized here so every wrapped route gets the right status without
  // touching ~20 individual `req.json()` call sites.
  if (err instanceof SyntaxError) {
    return NextResponse.json({ error: "invalid_json", message: "Request body is not valid JSON." }, { status: 400 });
  }
  console.error("[unhandled]", err);
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}

/// Wrap an async handler so unhandled errors become consistent JSON responses.
// fix(audit pentest-csrf-defense-in-depth): the canonical API runs as Next.js
// Route Handlers on Vercel, which (unlike the Express service's csrfGuard) had no
// server-side CSRF control — it relied solely on the cs_session cookie's
// SameSite=Lax. Add the same Sec-Fetch-Site guard here as defense-in-depth: block
// CROSS-SITE state-changing requests. Reads + same-origin/same-site/none writes +
// non-browser clients (no header → curl/native/S2S) are allowed; only a browser
// request initiated by a third-party page is rejected. Token-credentialed routes
// (/contacts/confirm/<token>, /share/<token>) carry their own unguessable bearer
// in the path, so they're allowlisted.
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
function isCsrfAllowlisted(pathname: string): boolean {
  return pathname.includes("/confirm/") || pathname.includes("/share/");
}
// Exported so streaming routes that can't go through `wrap` (e.g. /api/assistant,
// which returns a raw text-stream Response) can still apply the same CSRF guard.
export function csrfBlocked(args: unknown[]): NextResponse | null {
  const req = args[0] as { method?: string; headers?: { get(name: string): string | null }; nextUrl?: { pathname: string } } | undefined;
  if (!req || typeof req.method !== "string" || !req.headers?.get) return null;
  if (!STATE_CHANGING.has(req.method)) return null;
  const site = req.headers.get("sec-fetch-site");
  // No header → non-browser client (not the CSRF threat model). same-origin/
  // same-site/none → legitimate first-party or app-initiated. Only "cross-site"
  // is the CSRF vector.
  if (site !== "cross-site") return null;
  if (req.nextUrl && isCsrfAllowlisted(req.nextUrl.pathname)) return null;
  return NextResponse.json(
    { error: "csrf_blocked", message: "Cross-site state-changing requests are blocked. Retry from the app." },
    { status: 403 },
  );
}

/// Wrap an async handler so unhandled errors become consistent JSON responses.
export function wrap<T extends (...args: never[]) => Promise<NextResponse>>(fn: T): T {
  return (async (...args: Parameters<T>) => {
    const blocked = csrfBlocked(args as unknown[]);
    if (blocked) return blocked;
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err);
    }
  }) as T;
}
