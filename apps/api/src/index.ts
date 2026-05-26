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
import { Agent, setGlobalDispatcher } from "undici";
import { globalLimiter } from "./middleware/rate-limit.js";

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

app.use(express.json({ limit: "200kb" }));
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || corsOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

// v92 — global per-IP rate limit (skips /health + /diag/*).
app.use(globalLimiter);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "travelsafe-api", time: new Date().toISOString() });
});

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
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[api] ${sig} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
