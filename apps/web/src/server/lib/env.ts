import "server-only";
import { z } from "zod";

// Validated server env, used only inside Route Handlers and server services.
// The TravelSafe API used to live in apps/api; everything here was migrated to
// run as Next.js Route Handlers on Vercel.

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // DATABASE_URL and JWT_SECRET are *runtime* requirements but kept optional
  // in the schema so Next.js's build-time module evaluation doesn't crash
  // when they're missing. Routes that need them throw a clear error if unset.
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  JWT_EXPIRES_IN: z.string().default("7d"),
  BCRYPT_ROUNDS: z.coerce.number().default(12),

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

  // Check-in cron (Vercel Cron runs every minute by default)
  CHECKIN_GRACE_SECONDS: z.coerce.number().default(120),
  CRON_SECRET: z.string().optional(), // optional shared secret for /api/cron/* protection

  // Vercel AI Gateway
  AI_GATEWAY_API_KEY: z.string().optional(),

  // Moderator allowlist (comma-separated emails)
  MODERATOR_EMAILS: z.string().default(""),
});

type ParsedEnv = z.infer<typeof Env>;

// Lazy validation: Next.js evaluates Route Handler modules at build time
// (page-data collection), so calling Env.parse() at import time crashes the
// build whenever DATABASE_URL / JWT_SECRET aren't set in the build env.
// Defer parse to first access — by then we're in a real request and the
// env vars are populated by Vercel.
let _cached: ParsedEnv | null = null;
function _read(): ParsedEnv {
  if (!_cached) _cached = Env.parse(process.env);
  return _cached;
}

export const env = new Proxy({} as ParsedEnv, {
  get(_t, key) { return _read()[key as keyof ParsedEnv]; },
  has(_t, key) { return key in _read(); },
  ownKeys() { return Object.keys(_read()); },
  getOwnPropertyDescriptor(_t, key) { return Object.getOwnPropertyDescriptor(_read(), key); },
});
