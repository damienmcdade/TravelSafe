import nodemailer from "nodemailer";
import { env } from "../../env.js";

let transport: nodemailer.Transporter | null = null;

function getTransport() {
  if (transport) return transport;
  if (!env.SMTP_URL) {
    transport = nodemailer.createTransport({ jsonTransport: true });
  } else {
    transport = nodemailer.createTransport(env.SMTP_URL);
  }
  return transport;
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
): Promise<{ ok: boolean; messageId?: string | null; reason?: string }> {
  // fix(audit api-code-2): sendMail() THROWS on an SMTP error, but the only
  // caller (notifyContact) treats the result as a boolean. An unwrapped throw
  // propagated out of notifyContact and aborted the rest of an emergency
  // check-in / SOS fan-out — so one bad SMTP send silenced every remaining
  // trusted contact. Catch it and return { ok:false } so the fan-out continues
  // (mirrors the web notifications/email.ts behaviour).
  let result: Awaited<ReturnType<nodemailer.Transporter["sendMail"]>>;
  try {
    const t = getTransport();
    result = await t.sendMail({
      from: env.NOTIFY_EMAIL_FROM,
      to,
      subject,
      text,
    });
  } catch (e) {
    console.warn("[email] send failed:", (e as Error).message);
    return { ok: false, reason: (e as Error).message };
  }
  if (!env.SMTP_URL) {
    // v96 — the prior log included `to` (user email) which the
    // observability audit flagged as PII reaching plaintext logs.
    // Now just emit a structured signal for dev debugging without
    // the address. If you genuinely need the address while
    // debugging, set DEV_EMAIL_LOG_ADDRESSES=1 in your local .env.
    if (process.env.DEV_EMAIL_LOG_ADDRESSES === "1") {
      console.log("[email:dev-noop]", { to, subjectLen: subject.length, textLen: text.length });
    } else {
      const hashedTo = `${to.slice(0, 2)}…@${to.split("@")[1] ?? "?"}`;
      console.log("[email:dev-noop]", { hashedTo, subjectLen: subject.length, textLen: text.length });
    }
  }
  return { ok: true, messageId: result.messageId ?? null };
}
