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
export function wrap<T extends (...args: never[]) => Promise<NextResponse>>(fn: T): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err);
    }
  }) as T;
}
