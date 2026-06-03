import { NextResponse } from "next/server";
import { wrap } from "@/server/lib/http";
import { env } from "@/server/lib/env";

export const dynamic = "force-dynamic";

// fix(audit safety-sms-unconfigured-2): expose whether SMS delivery is actually
// configured so the UI can warn that phone-only trusted contacts won't be
// alerted (Twilio creds are unset in this deployment). No secrets are exposed —
// only the boolean capability.
export const GET = wrap(async () => {
  const sms = !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER);
  return NextResponse.json({ sms });
});
