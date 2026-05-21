import nodemailer from "nodemailer";
import { env } from "../../lib/env";

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
    console.log("[email:dev-noop]", { to, subject, preview: text.slice(0, 120) });
  }
  return { ok: true, messageId: result.messageId ?? null };
}
