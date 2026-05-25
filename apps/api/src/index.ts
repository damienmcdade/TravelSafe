import express from "express";
import cors from "cors";
import morgan from "morgan";
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
import { startCheckInWorker } from "./services/safety/check-in.worker.js";
import { startDigestWorker } from "./services/push/digest.worker.js";

const app = express();

// Railway (like every PaaS) terminates TLS at its edge and forwards
// requests with X-Forwarded-For set. Trust one proxy hop so
// express-rate-limit can key by the real client IP instead of the
// Railway proxy's IP (which would make the rate limit effectively
// global rather than per-user). The "1" specifically means "trust
// the closest proxy"; we are NOT behind multiple proxy layers.
app.set("trust proxy", 1);

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

app.use(notFound);
app.use(errorHandler);

const server = app.listen(env.LISTEN_PORT, () => {
  console.log(`[api] listening on :${env.LISTEN_PORT} (env=${env.NODE_ENV})`);
  startCheckInWorker();
  startDigestWorker();
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[api] ${sig} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
