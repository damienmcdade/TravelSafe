import "dotenv/config";
import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Railway (and most PaaS) injects PORT. API_PORT is honored as a fallback
  // for local dev where developers may have set the older variable name.
  PORT: z.coerce.number().optional(),
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  BCRYPT_ROUNDS: z.coerce.number().default(12),
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
  VAPID_SUBJECT: z.string().default("mailto:ops@travelsafe.example"),

  // Trusted-contact notifications
  TRUSTED_CONTACT_CHANNEL: z.enum(["email", "sms", "both"]).default("email"),
  LIVE_SHARE_BASE_URL: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  NOTIFY_EMAIL_FROM: z.string().default("alerts@travelsafe.example"),
  SMTP_URL: z.string().optional(),

  // Check-in worker
  CHECKIN_WORKER_INTERVAL_SECONDS: z.coerce.number().default(30),
  CHECKIN_GRACE_SECONDS: z.coerce.number().default(120),

  // Vercel AI Gateway (composer coach). Optional — when unset, the composer
  // gracefully falls back to local pre-vetter rules only.
  AI_GATEWAY_API_KEY: z.string().optional(),
});

const parsed = Env.parse(process.env);

// Effective listen port — PORT (PaaS) wins over API_PORT (legacy/local).
export const env = { ...parsed, LISTEN_PORT: parsed.PORT ?? parsed.API_PORT };

export const corsOrigins = env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
