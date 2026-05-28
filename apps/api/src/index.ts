// v95p31 — keep the process alive when a library callback throws.
// Specifically we've seen undici's HTTP-1 parser throw
// `AssertionError: assert(!this.paused)` from inside a TLSSocket
// `end` handler when an upstream response is cut mid-flight (warm-
// worker fetching adapter pages). Without these handlers the
// assertion takes down the whole Node process and Railway has been
// restart-looping. Log loudly so we still see the cause, but don't
// exit — there's no useful in-process recovery for an interrupted
// HTTP response that the calling code has already moved past.
process.on("uncaughtException", (err) => {
  // Format the error verbosely so log greps still catch the stack.
   
  console.error("[uncaughtException]", err?.name, err?.message, err?.stack);
  // v96 — also forward to Sentry if armed. No-op when SENTRY_DSN is
  // unset (uses the local import below; module load order is fine
  // because Sentry's init runs before any handler can fire).
  try { void import("./lib/sentry.js").then((s) => s.captureException(err, { route: "uncaughtException" })); } catch {}
});
process.on("unhandledRejection", (reason) => {
   
  console.error("[unhandledRejection]", reason);
  try { void import("./lib/sentry.js").then((s) => s.captureException(reason, { route: "unhandledRejection" })); } catch {}
});

import express from "express";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import { env, corsOrigins } from "./env.js";
import { notFound, errorHandler } from "./middleware/error.js";
import { authRouter } from "./routes/auth.routes.js";
import { contactsRouter } from "./routes/contacts.routes.js";
import { preferencesRouter } from "./routes/preferences.routes.js";
import { crimeDataRouter } from "./routes/crime-data.routes.js";
import { communityRouter } from "./routes/community.routes.js";
import { neighborhoodRouter } from "./routes/neighborhood.routes.js";
import { moderationRouter } from "./routes/moderation.routes.js";
import { safetyRouter } from "./routes/safety.routes.js";
import { pushRouter } from "./routes/push.routes.js";
import { shareRouter } from "./routes/share.routes.js";
import { geoRouter } from "./routes/geo.routes.js";
import { aiRouter } from "./routes/ai.routes.js";
import { officialAlertsRouter } from "./routes/official-alerts.routes.js";
import { safezoneRouter } from "./routes/safezone.routes.js";
import { startCheckInWorker } from "./services/safety/check-in.worker.js";
import { startDigestWorker } from "./services/push/digest.worker.js";
import { startWarmWorker } from "./services/warm/cache.worker.js";
import { startGradeSanityWorker, getLastReport as getGradeSanityReport } from "./services/audit/grade-sanity.worker.js";
import { startAuditRetentionWorker } from "./services/audit/retention.worker.js";
import { Agent, setGlobalDispatcher } from "undici";
import { globalLimiter } from "./middleware/rate-limit.js";
import { csrfGuard } from "./middleware/csrf.js";
import { requestId } from "./middleware/request-id.js";
import { initSentry, sentryRequestMiddleware } from "./lib/sentry.js";

// v96 — initSentry must run BEFORE the rest of the middleware mounts so
// that error tracking captures cold-start crashes too. No-op when
// SENTRY_DSN is unset (local dev, every env without observability
// config). When set in prod, every unhandledRejection / uncaughtException
// already wired above also routes through Sentry via the lazy import.
initSentry();

// v90p5 — pooled HTTP dispatcher inlined here (was previously in
// @travelsafe/crime-data/lib/http but undici's node: scheme imports
// crashed the Vercel webpack bundle as a transitive dep). apps/api
// is Node-only so it can import undici directly.
function installPooledDispatcher(): void {
  setGlobalDispatcher(new Agent({
    keepAliveTimeout: 60_000,
    keepAliveMaxTimeout: 600_000,
    connections: 10,
    pipelining: 1,
    // v96 — cap header + body wait at 30s each. undici's defaults are
    // 5 minutes, which meant a single hung upstream (Cleveland ArcGIS,
    // KC Socrata) would hold a multi-MB row buffer alive for the full
    // 5 min while the next warm-worker cycle started piling more buffers
    // on top. Repeated Railway container OOM kills (RSS ~2.9 GB → SIGABRT
    // → restart loop) traced back to this. 30 s is much longer than any
    // legitimate upstream and well below the 4-min warm cycle, so failures
    // get released back to the GC instead of accumulating.
    headersTimeout: 30_000,
    bodyTimeout: 30_000,
  }));
}

const app = express();

// Railway (like every PaaS) terminates TLS at its edge and forwards
// requests with X-Forwarded-For set. Trust one proxy hop so
// express-rate-limit can key by the real client IP instead of the
// Railway proxy's IP (which would make the rate limit effectively
// global rather than per-user). The "1" specifically means "trust
// the closest proxy"; we are NOT behind multiple proxy layers.
app.set("trust proxy", 1);

// v92 — helmet adds HSTS + X-CTO + X-Frame-Options + Referrer-Policy
// to every API response (DISA STIG SC-8, SC-23). HSTS 2 years +
// includeSubDomains + preload covers FedRAMP moderate baseline.
// CSP is intentionally OFF here — the API only serves JSON, so a
// CSP would be ignored by browsers and noise in the response.
// crossOriginResourcePolicy=cross-origin so the web app on a
// different Vercel domain can still call this API.
app.use(helmet({
  contentSecurityPolicy: false,
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: "no-referrer" },
}));

// v96 — assign a request correlation ID FIRST so every downstream
// middleware (cors, rate-limit, csrf, route handlers, errors) can
// reference it.
app.use(requestId);
// v96 — Sentry per-request breadcrumb. No-op when SENTRY_DSN is
// unset. Sits right after requestId so the breadcrumb timeline is
// scoped to a single rid.
app.use(sentryRequestMiddleware);

app.use(express.json({ limit: "200kb" }));
app.use(
  cors({
    // v96 — was `cb(new Error(...))` for unknown origins, which
    // propagated through the global error handler as HTTP 500
    // (cluttering Sentry + Railway error metrics). `cb(null, false)`
    // makes cors() emit the response WITHOUT an Access-Control-
    // Allow-Origin header — the browser still blocks the cross-
    // origin request, but the status code stays clean (200 for
    // simple methods, 204 for preflight) instead of polluting error
    // dashboards.
    origin: (origin, cb) => {
      if (!origin || corsOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
  }),
);
// v96 — register :request-id token so the combined access log carries
// the correlation ID. Format extends standard `combined` with the ID
// at the end.
morgan.token("request-id", (_req, res) => (res as import("express").Response).locals?.requestId ?? "-");
const PROD_FORMAT = ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" rid=:request-id';
app.use(morgan(env.NODE_ENV === "production" ? PROD_FORMAT : "dev"));

// v92 — global per-IP rate limit (skips /health + /diag/*).
app.use(globalLimiter);
// v96 — Sec-Fetch-Site CSRF guard on POST/PUT/PATCH/DELETE. Reads
// always pass; writes from cross-site origins are blocked. Documented
// in middleware/csrf.ts.
app.use(csrfGuard);

// /health is Railway's healthcheckPath; /healthz is the
// kubernetes-style alias an external uptime monitor was hitting and
// getting 404s every 6s. Both return the same payload so either probe
// shape is silently supported.
// v96 — include the git SHA + boot time in the health payload so a
// log line "rid=abc123 status=500" can be cross-referenced to the
// exact deploy that served it. Railway exposes the deploy's commit
// SHA via RAILWAY_GIT_COMMIT_SHA; fall back to "unknown" locally.
const BUILD_SHA = (process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? "unknown").slice(0, 7);
const BOOT_TIME = new Date().toISOString();
// v96 — heap stats in /health. Today's Prisma 6 + Zod 4 deploy went
// into crashloop with "Ineffective mark-compacts near heap limit"
// after the warm-worker accumulated ~3.5 GB across all city
// adapters. The crash was invisible until exit 134, because /health
// only reported ok:true. Exposing heap used / heap total lets an
// external uptime monitor watch the trajectory and page ops before
// the next OOM rather than after.
const healthHandler = (_req: import("express").Request, res: import("express").Response) => {
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    service: "travelsafe-api",
    time: new Date().toISOString(),
    buildSha: BUILD_SHA,
    bootedAt: BOOT_TIME,
    heap: {
      usedMB: Math.round(mem.heapUsed / 1024 / 1024),
      totalMB: Math.round(mem.heapTotal / 1024 / 1024),
      rssMB: Math.round(mem.rss / 1024 / 1024),
    },
  });
};
app.get("/health", healthHandler);
app.get("/healthz", healthHandler);

app.use("/auth", authRouter);
app.use("/contacts", contactsRouter);
app.use("/preferences", preferencesRouter);
app.use("/crime-data", crimeDataRouter);
app.use("/community", communityRouter);
app.use("/neighborhood", neighborhoodRouter);
app.use("/moderation", moderationRouter);
app.use("/safety", safetyRouter);
app.use("/push", pushRouter);
app.use("/share", shareRouter);
app.use("/geo", geoRouter);
app.use("/ai", aiRouter);
app.use("/official-alerts", officialAlertsRouter);
app.use("/safezone", safezoneRouter);

// v64 — grade sanity diagnostic. Read-only summary of the latest
// in-process grade-sanity report. Public read because it's pure
// diagnostics (no secrets, no user data), same posture as /health.
// MUST be registered BEFORE app.use(notFound) — otherwise the
// catch-all 404 middleware intercepts the request first.
app.get("/diag/grade-sanity", (_req, res) => {
  const r = getGradeSanityReport();
  if (!r) return res.status(503).json({ error: "no_report_yet", message: "Worker has not completed its first cycle." });
  res.json(r);
});

app.use(notFound);
app.use(errorHandler);

// v87 — pooled HTTP dispatcher with keep-alive. Eliminates the
// ~200-400ms TLS handshake every adapter page-fetch previously paid
// (Node's global fetch defaults to an ephemeral per-call dispatcher).
// Biggest win on Cleveland (30 pages/cycle) + DC (60 pages/cycle).
installPooledDispatcher();

const server = app.listen(env.LISTEN_PORT, () => {
  console.log(`[api] listening on :${env.LISTEN_PORT} (env=${env.NODE_ENV})`);
  startCheckInWorker();
  startDigestWorker();
  startWarmWorker();
  startGradeSanityWorker();
  startAuditRetentionWorker();
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[api] ${sig} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
