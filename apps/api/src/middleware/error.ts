import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { captureException } from "../lib/sentry.js";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: "not_found" });
}

 
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  // If headers already went out (e.g. an error mid-SSE-stream or after a
  // partial response), res.status()/json() would throw ERR_HTTP_HEADERS_SENT.
  // Delegate to Express's default handler, which closes the connection.
  if (res.headersSent) {
    return _next(err);
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "validation_failed", issues: err.issues });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  // v96 — body-parser surfaces oversized JSON as
  // PayloadTooLargeError with err.type === "entity.too.large" and
  // err.statusCode === 413. Catch it here so callers get the
  // expected 413 instead of the generic 500 the pen test flagged.
  // Same shape catches JSON parse errors (400 instead of 500).
  if (err && typeof err === "object") {
    const e = err as { type?: string; status?: number; statusCode?: number };
    if (e.type === "entity.too.large" || e.statusCode === 413) {
      return res.status(413).json({ error: "payload_too_large" });
    }
    if (e.type === "entity.parse.failed") {
      return res.status(400).json({ error: "invalid_json" });
    }
  }
  console.error("[unhandled]", err);
  // v96 — forward to Sentry if armed. The user-facing response is
  // still the generic 500 we already had; this just makes the
  // failure visible in the error dashboard with the request ID +
  // route. No-op when SENTRY_DSN is unset.
  captureException(err, {
    requestId: res.locals?.requestId,
    userId: req.session?.uid,
    route: `${req.method} ${req.path}`,
  });
  res.status(500).json({ error: "internal_error" });
}
