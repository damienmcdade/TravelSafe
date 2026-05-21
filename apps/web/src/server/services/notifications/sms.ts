import { env } from "../../lib/env";

// Lightweight Twilio sender using the REST API directly to avoid a heavy dep.
// Returns { ok: false, skipped: true } if creds aren't set, so the dispatcher
// can transparently fall back to email per spec.
export async function sendSms(to: string, body: string): Promise<{ ok: boolean; skipped?: boolean; status?: number }> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
    return { ok: false, skipped: true };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const form = new URLSearchParams({ To: to, From: env.TWILIO_FROM_NUMBER, Body: body });
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  return { ok: res.ok, status: res.status };
}
