import "server-only";
import { env } from "./env";

// Absolute base URL for links we embed in emails/SMS (password reset,
// trusted-contact confirmation, live-share). Resolution order:
//   1. LIVE_SHARE_BASE_URL — explicit operator override (custom domain).
//   2. VERCEL_PROJECT_PRODUCTION_URL — injected by Vercel on every deploy
//      with the project's production domain. This makes outbound links work
//      even when the override was never configured; previously that case
//      silently fell back to http://localhost:3000, i.e. broken password-
//      reset and contact-confirm links in production.
//   3. VERCEL_URL — preview deployments.
//   4. localhost — local dev.
export function publicBaseUrl(): string {
  const explicit = env.LIVE_SHARE_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}
