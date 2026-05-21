import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

/// Standard error response shape across all Route Handlers.
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    return NextResponse.json({ error: "validation_failed", issues: err.issues }, { status: 400 });
  }
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
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
