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
import compression from "compression";
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
import { startProximityWorker } from "./services/safety/proximity.worker.js";
import { startDigestWorker } from "./services/push/digest.worker.js";
// v96p2 — startWarmWorker import removed from the call path. See
// the boot section below for the rationale.
// import { startWarmWorker } from "./services/warm/cache.worker.js";
// v98 — the in-process grade-sanity worker is RETIRED. Grade monitoring
// moved to the external `audit-ratios` Vercel cron (apps/web/src/app/api/
// cron/audit-ratios), which is strictly more reliable: it runs off-process
// (survives api restarts, can't OOM the api), computes fresh each run (no
// dependence on a warm Redis cache the in-process worker couldn't get),
// and probes the same per-city safety-score. The worker's recompute sweep
// was the heap-spike OOM source, and once made read-only it only ever
// reported NO_WARM_DATA — dead weight either way.
import { startAuditRetentionWorker } from "./services/audit/retention.worker.js";
import { evictAllRowCaches, evictColdRowCaches, registeredRowCacheCount, computeLimitStats } from "@travelsafe/crime-data/cache-registry";
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

// v97 — memory watchdog: the ROOT-CAUSE guard for the recurring OOM
// crashloop (exit 134 "Ineffective mark-compacts near heap limit" at
// ~15 min uptime). The 37 city adapters each hold their fetched rows in
// a module-level cache that never frees once populated, so resident heap
// climbs past the 3.5 GB old-space cap as cities are touched (a warm
// sweep of all of them, or just organic traffic over time). --expose-gc
// alone can't help: the rows are RETAINED by the caches, so they aren't
// garbage. This polls heapUsed every 30s and, once it crosses a
// high-water mark set well under the cap, drops EVERY registered adapter
// cache (each refetches lazily on its next request, rebuilding its 5-min
// cache) and forces a GC so the freed rows are actually reclaimed. The
// trade is a one-request latency blip under pressure instead of a crash;
// resident memory is bounded regardless of how many cities are cached.
//
// v98 — poll 30s→8s and high-water 2200→1700MB. The watchdog bounds the
// RESIDENT baseline well, but v97 still OOM'd once: a burst of concurrent
// cold city computes (grade-sanity recompute) spiked heap from ~550MB
// past the 3584 cap inside a single 30s poll gap. The primary fix is
// making grade-sanity read-only (no recompute — see grade-sanity.worker
// .ts), which removes that burst; this faster/lower watchdog is the
// backstop for any remaining organic spike, giving ~1.9GB of headroom
// to the cap and re-checking every 8s.
const HEAP_HIGH_WATER_MB = 1700;
// v99 — LRU eviction. Phase 1 evicts the COLD adapter caches (everything
// except the few most-recently-served cities) so active users don't get a
// cold upstream refetch every time memory blips. Phase 2 is the original
// all-or-nothing eviction, kept verbatim as the OOM safety fallback: if
// dropping the cold caches didn't pull heap back under the high-water mark,
// we still nuke EVERYTHING (and GC), exactly as before. So the crash-
// prevention guarantee is unchanged; this only spares the hot cities when
// the cold ones were enough.
const HEAP_KEEP_HOT = 3;
let lastEvictAt: string | null = null;
let evictCount = 0;
function startMemoryWatchdog(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  const heapMB = () => process.memoryUsage().heapUsed / 1024 / 1024;
  const timer = setInterval(() => {
    const usedMB = heapMB();
    if (usedMB < HEAP_HIGH_WATER_MB) return;
    const before = Math.round(usedMB);

    // Phase 1 — drop cold caches, keep the hottest few warm.
    let cleared = evictColdRowCaches(HEAP_KEEP_HOT);
    if (gc) gc();
    let after = Math.round(heapMB());
    let phase = "cold";

    // Phase 2 — safety fallback. Still over the line? Evict everything.
    if (heapMB() >= HEAP_HIGH_WATER_MB) {
      cleared += evictAllRowCaches();
      if (gc) gc();
      after = Math.round(heapMB());
      phase = "cold+full";
    }

    lastEvictAt = new Date().toISOString();
    evictCount += 1;
    console.warn(
      `[mem-watchdog] heap ${before}MB >= ${HEAP_HIGH_WATER_MB}MB high-water -> ` +
      `${phase} eviction: cleared ${cleared}/${registeredRowCacheCount()} adapter caches, gc -> ${after}MB`,
    );
  }, 8_000);
  // Don't keep the event loop alive solely for the watchdog.
  timer.unref();
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

// v99 — gzip/br compression. The freshness audit found every API response
// transferred uncompressed; the citywide trend alone is ~760 KB raw, and
// even after the bullets cap the full trend / citywide / mix payloads are
// large. Compression shrinks them >80% on the wire — both for the
// Vercel→Railway proxy hop (which must download the whole body before
// responding to the user) and for any direct API consumer.
//
// SSE SAFETY: the /community/stream endpoint must NOT be buffered/
// compressed. It sets `Content-Type: text/event-stream` and
// `Cache-Control: no-transform` before its first write; compression
// honors `no-transform` and the explicit content-type filter below skips
// it too, so the live event stream is never held back.
app.use(compression({
  filter: (req, res) => {
    const ct = String(res.getHeader("Content-Type") ?? "");
    if (ct.includes("text/event-stream")) return false;
    return compression.filter(req, res);
  },
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
const healthHandler = (req: import("express").Request, res: import("express").Response) => {
  // fix(audit pentest-health-1 + pentest-brand-health-leak): the unauthenticated
  // probe used to expose internal heap/cache/compute telemetry + the legacy
  // brand to anyone. Keep the public probe minimal (Railway's healthcheck only
  // needs a 200); expose the detailed ops telemetry only to a caller holding the
  // operator secret so monitors that want heap trajectory can still get it.
  const authed = !!env.CRON_SECRET && req.header("authorization") === `Bearer ${env.CRON_SECRET}`;
  if (!authed) {
    res.json({ ok: true, service: "communitysafe-api", time: new Date().toISOString() });
    return;
  }
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    service: "communitysafe-api",
    // v100 — prismaMajor lets us confirm which client generation is actually
    // running in production (the Prisma 7 cutover). 7 = adapter-pg + generated
    // ./src/generated/prisma client; 6 = legacy @prisma/client.
    prismaMajor: 7,
    time: new Date().toISOString(),
    buildSha: BUILD_SHA,
    bootedAt: BOOT_TIME,
    heap: {
      usedMB: Math.round(mem.heapUsed / 1024 / 1024),
      totalMB: Math.round(mem.heapTotal / 1024 / 1024),
      rssMB: Math.round(mem.rss / 1024 / 1024),
    },
    // v97 — memory-watchdog telemetry so an external monitor can see
    // whether cache eviction is firing (and how often) without waiting
    // for a crash.
    cache: {
      registered: registeredRowCacheCount(),
      highWaterMB: HEAP_HIGH_WATER_MB,
      evictions: evictCount,
      lastEvictAt,
    },
    // v103 — heavy-compose concurrency gate (bounds peak heap from concurrent
    // cold city composes; see crime-data/lib/compute-limit.ts). `queued` > 0
    // under load means the gate is shedding burst pressure as designed.
    compute: computeLimitStats(),
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

// v98 — grade-sanity diagnostic retired alongside the in-process worker.
// Kept as a 200 pointer (not a 404) so anything still polling this path
// gets a clear redirect to the external monitor instead of a hard error.
app.get("/diag/grade-sanity", (_req, res) => {
  res.json({
    retired: true,
    message: "In-process grade-sanity worker retired in v98. Grade monitoring moved to the external audit-ratios Vercel cron.",
    monitor: "GET /api/cron/audit-ratios (Vercel, daily 09:07 UTC; cron-secret protected)",
  });
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
  startProximityWorker();
  startDigestWorker();
  // v96p2 — startWarmWorker() permanently removed from the boot path.
  // The 6-cycle deployment-log scan confirmed pods OOM at ~+15 min
  // every time the worker fires, regardless of mitigations (heavy
  // bucket trim 14 → 6, GC at cycle / mid-cycle / heap-aware
  // backoff). Steady-state heap during a heavy cycle reaches 2.8 GB
  // and the GC reclaims only 24 MB at saturation — the worker
  // simply outpaces V8's ability to recover. Routes serve from
  // Redis L2 (warm from prior pods) and on-demand adapter fetches
  // (each handler triggers one upstream call, 5-min in-process
  // cache, GC-friendly), which together cover the steady-state load
  // without the cumulative pressure. Re-enabling the worker is a
  // future task once the underlying allocation path is profiled
  // (likely undici body pools or adapter intermediate JSON.parse
  // outputs not being released between cycles).
  // startWarmWorker();
  // startGradeSanityWorker() — retired; see import-site note. Grade
  // monitoring is the external audit-ratios Vercel cron now.
  startAuditRetentionWorker();
  // v97 — arm the memory watchdog last so it covers steady-state.
  startMemoryWatchdog();
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[api] ${sig} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
