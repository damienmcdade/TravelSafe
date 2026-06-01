import "server-only";
import { z } from "zod";

// Validated server env, used only inside Route Handlers and server services.
// The CommunitySafe API used to live in apps/api; everything here was migrated to
// run as Next.js Route Handlers on Vercel.

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // DATABASE_URL and JWT_SECRET are *runtime* requirements but kept optional
  // in the schema so Next.js's build-time module evaluation doesn't crash
  // when they're missing. Routes that need them throw a clear error if unset.
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  // Session lifetime. Was 7d originally; shortened to 24h on the
  // audit's recommendation because: (a) tokens live in localStorage
  // and a leak via XSS or shared device would otherwise stay valid
  // for a full week, (b) we have no server-side revocation table yet
  // — a shorter window IS the revocation strategy until a tokenVersion
  // column lands. Anonymous sessions re-bootstrap silently on expiry
  // via useAnonymousAuth so the only user-visible effect is registered
  // users having to re-login once a day.
  JWT_EXPIRES_IN: z.string().default("24h"),
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
  VAPID_SUBJECT: z.string().default("mailto:info@cyberwaveglobal.com"),

  // Trusted-contact notifications
  TRUSTED_CONTACT_CHANNEL: z.enum(["email", "sms", "both"]).default("email"),
  LIVE_SHARE_BASE_URL: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  NOTIFY_EMAIL_FROM: z.string().default("alerts@cyberwaveglobal.com"),
  SMTP_URL: z.string().optional(),

  // Check-in cron (Vercel Cron runs every minute by default)
  CHECKIN_GRACE_SECONDS: z.coerce.number().default(120),
  CRON_SECRET: z.string().optional(), // optional shared secret for /api/cron/* protection

  // AI provider — Google Gemini (free tier).
  // Get a key at https://aistudio.google.com/app/apikey. The provider
  // accepts any of the three common env var names (Google's own SDK uses
  // GOOGLE_GENERATIVE_AI_API_KEY; AI Studio shows GEMINI_API_KEY; legacy
  // Google client libraries use GOOGLE_API_KEY). Whichever you set, the
  // provider picks it up. Free tier: 15 RPM / 1,500 RPD on gemini-2.0-flash.
  // AI_GATEWAY_API_KEY is the legacy paid-Vercel-AI-Gateway fallback.
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  GEMINI_API_KEY:               z.string().optional(),
  GOOGLE_API_KEY:               z.string().optional(),
  // Groq is a second free AI provider. Llama 3.3 70B Versatile is free at
  // 30 RPM / 14,400 RPD — totally separate quota from Gemini, so it's a clean
  // backup when a Gemini key hits its zero-quota project trap. Get a free
  // key at https://console.groq.com/keys.
  GROQ_API_KEY:                 z.string().optional(),
  GROQAPI:                      z.string().optional(),  // alternate name some users set
  AI_GATEWAY_API_KEY:           z.string().optional(),

  // Cloudflare Worker that proxies data.boston.gov for the Boston adapter.
  // data.boston.gov rejects requests from Vercel's IP range for any non-
  // trivial response size; the Worker (deployed from /workers/boston-proxy)
  // sits on Cloudflare's edge and forwards transparently. When BOSTON_PROXY_URL
  // is set, the Boston adapter routes through it; otherwise it falls back to
  // a direct call (currently 0-record from Vercel).
  BOSTON_PROXY_URL: z.string().url().optional(),

  // OpenRouteService — production routing engine for Safe Route (foot-walking /
  // driving-car profiles + avoid_polygons so routes actively steer AROUND the
  // hottest neighborhoods, not just score OSRM's defaults). Free key (2,000
  // req/day, 40/min) at https://openrouteservice.org/dev/#/signup. When unset,
  // Safe Route falls back to the public OSRM demo (router.project-osrm.org),
  // which is fine for dev but rate-limited / best-effort for production.
  OPENROUTESERVICE_API_KEY: z.string().optional(),

  // Vercel Blob (optional). When a Blob store is provisioned, Vercel injects
  // BLOB_READ_WRITE_TOKEN automatically; with it set, community posts can carry
  // a user-uploaded photo (Ring-Neighbors-style). Unset → the photo button is
  // disabled and /api/community/upload returns 503 (text posts still work).
  BLOB_READ_WRITE_TOKEN: z.string().optional(),

  // Redis (optional). When set, live community updates (SSE) fan out through
  // Redis pub/sub so an event emitted on one serverless instance reaches SSE
  // clients held open on a DIFFERENT instance. Unset → in-process EventEmitter
  // only (correct for a single warm instance; can miss cross-instance events
  // under Fluid Compute fan-out). Same Redis the Railway API uses — point both
  // at the one instance. The client connects lazily and fails soft.
  REDIS_URL: z.string().url().optional(),

  // Moderator allowlist (comma-separated emails)
  MODERATOR_EMAILS: z.string().default(""),

  // Railway API base. When set, the Vercel-side AI explainer (and any
  // other route migrated in route-parity Phase 2) proxies upstream to
  // Railway so they hit the shared Redis cache instead of the per-
  // function-instance LRU. Server-only — never exposed to the client.
  API_BASE_URL: z.string().url().optional(),
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
