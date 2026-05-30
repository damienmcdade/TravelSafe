import "dotenv/config";
import { z } from "zod";

// Coerce empty-string env vars to undefined so a misconfigured
// "KEY=" on the platform falls through to the zod default instead
// of failing the enum check. Railway / Vercel / Docker all allow
// setting a key with an empty value, and treating that as "use
// default" is the kinder behavior than refusing to start.
const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const Env = z.object({
  NODE_ENV: z.preprocess(emptyToUndefined, z.enum(["development", "test", "production"]).default("development")),
  // Railway (and most PaaS) injects PORT. API_PORT is honored as a fallback
  // for local dev where developers may have set the older variable name.
  PORT: z.coerce.number().optional(),
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  // v96 — bumped 12 → 13 per dep audit (OWASP 2025 guidance pushes
  // cost factor toward 13–14 as commodity GPU speed climbs). bcryptjs
  // pure-JS at cost 13 lands around 350 ms per hash on Railway's
  // shared CPU — slow enough to slow brute-force, fast enough that
  // a single login still feels instant. Holding at 13 (not 14) to
  // keep the anonymous-device-session cold start under 1 s; if the
  // app later switches to the native bcrypt binding, revisit.
  BCRYPT_ROUNDS: z.coerce.number().default(13),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  // Crime-data adapters
  SANDAG_SOCRATA_BASE: z.string().url().default("https://data.sandiegocounty.gov"),
  SANDAG_CRIME_RATES_RESOURCE_ID: z.string().default("486f-q228"),
  SANDAG_SOCRATA_APP_TOKEN: z.string().optional(),
  SDPD_NIBRS_CSV_BASE: z.string().url().default("https://seshat.datasd.org/police_nibrs"),
  CRIME_DATA_ADAPTER: z.enum(["auto", "sandag", "sdpd", "mock"]).default("auto"),

  // Web Push
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:info@cyberwaveglobal.com"),

  // Trusted-contact notifications
  TRUSTED_CONTACT_CHANNEL: z.enum(["email", "sms", "both"]).default("email"),
  LIVE_SHARE_BASE_URL: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  NOTIFY_EMAIL_FROM: z.string().default("alerts@cyberwaveglobal.com"),
  SMTP_URL: z.string().optional(),

  // Check-in worker
  CHECKIN_WORKER_INTERVAL_SECONDS: z.coerce.number().default(30),
  CHECKIN_GRACE_SECONDS: z.coerce.number().default(120),

  // AI provider keys — same fallback chain as apps/web. Set any one
  // and the AI services pick the highest-priority configured provider
  // (Groq > Gemini > Vercel AI Gateway).
  GROQ_API_KEY:                 z.string().optional(),
  GROQAPI:                      z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  GEMINI_API_KEY:               z.string().optional(),
  GOOGLE_API_KEY:               z.string().optional(),
  AI_GATEWAY_API_KEY:           z.string().optional(),

  // Redis (Railway plugin). Optional — when unset, services that use it
  // (AI explainer cache, future per-instance shared state) fall back to
  // process-local stores. Set automatically by Railway when the Redis
  // plugin is attached.
  REDIS_URL: z.string().url().optional(),

  // Comma-separated list of moderator email addresses. Used by the
  // moderation routes (requireModerator) for MVP authorization until
  // a proper RBAC role table lands. Optional — when unset, no user
  // can call moderator-only endpoints (which fail-closed at 403).
  MODERATOR_EMAILS: z.string().optional(),

  // Cron secret for /diag/grade-sanity + warm-cache trigger routes.
  // Optional — when unset, cron routes return 503 (fail-closed).
  CRON_SECRET: z.string().optional(),
});

const parsed = Env.parse(process.env);

// Effective listen port — PORT (PaaS) wins over API_PORT (legacy/local).
export const env = { ...parsed, LISTEN_PORT: parsed.PORT ?? parsed.API_PORT };

export const corsOrigins = env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
