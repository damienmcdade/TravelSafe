import { env } from "../../lib/env";

// Lightweight Twilio sender using the REST API directly to avoid a heavy dep.
// Returns { ok: false, skipped: true } if creds aren't set, so the dispatcher
// can transparently fall back to email per spec.
export async function sendSms(to: string, body: string): Promise<{ ok: boolean; skipped?: boolean; status?: number; error?: string }> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
    return { ok: false, skipped: true };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const form = new URLSearchParams({ To: to, From: env.TWILIO_FROM_NUMBER, Body: body });
  // fix(audit sos-fanout-abort): a network throw from this fetch would propagate
  // up through notifyContact → the SOS Promise.all and abort the ENTIRE fan-out,
  // so one bad SMS could silence every other contact. Catch it and return a
  // failed receipt instead, so the dispatcher records the failure and moves on.
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: (e as Error)?.name ?? "send_failed" };
  }
}
