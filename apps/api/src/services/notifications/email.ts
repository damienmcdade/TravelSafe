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

export async function sendEmail(to: string, subject: string, text: string) {
  const t = getTransport();
  const result = await t.sendMail({
    from: env.NOTIFY_EMAIL_FROM,
    to,
    subject,
    text,
  });
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
