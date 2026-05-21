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
import { startCheckInWorker } from "./services/safety/check-in.worker.js";

const app = express();

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

app.use(notFound);
app.use(errorHandler);

const server = app.listen(env.LISTEN_PORT, () => {
  console.log(`[api] listening on :${env.LISTEN_PORT} (env=${env.NODE_ENV})`);
  startCheckInWorker();
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[api] ${sig} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
