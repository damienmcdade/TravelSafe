import * as Sentry from "@sentry/node";

// v96 — error tracking via Sentry. Conditional init: when SENTRY_DSN is
// unset (local dev, CI, any environment without observability config),
// every Sentry.* call is a no-op and nothing is sent. When set in
// production, unhandled exceptions, uncaught rejections, and explicit
// captureException() calls land in Sentry with the request correlation
// ID, the user ID (if authenticated), and the deploy SHA — closing the
// observability gap the quality-analysis audit flagged as critical
// ("no error tracking → silent production bugs unless ops watches
// Railway logs in real-time").
//
// Operator action to activate:
//   1. Create a Sentry project for "travelsafe-api" (Node platform).
//   2. Set SENTRY_DSN as a Railway env var (no quotes).
//   3. Redeploy — initSentry() detects the DSN and arms.
//
// The release tag uses the deploy SHA so error → commit correlation
// works without any extra wiring.

let initialized = false;

export function initSentry(): boolean {
  if (initialized) return true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? undefined,
    // Don't sample regular trace spans — we only want errors. Set
    // tracesSampleRate > 0 later if you want performance traces.
    tracesSampleRate: 0,
    // Server-side: capture every error. Sampling > 1 keeps every event.
    sampleRate: 1.0,
    // Don't send PII out — we already capture userId at the breadcrumb
    // layer, that's enough. Email/IP intentionally excluded.
    sendDefaultPii: false,
  });
  initialized = true;
  return true;
}

export function captureException(err: unknown, ctx?: { requestId?: string; userId?: string; route?: string }): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (ctx?.requestId) scope.setTag("request_id", ctx.requestId);
    if (ctx?.userId) scope.setUser({ id: ctx.userId });
    if (ctx?.route) scope.setTag("route", ctx.route);
    Sentry.captureException(err);
  });
}

export { Sentry };
