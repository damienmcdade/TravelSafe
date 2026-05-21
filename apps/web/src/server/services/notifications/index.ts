import { env } from "../../lib/env";
import { sendEmail } from "./email";
import { sendSms } from "./sms";

export type DeliveryStatus = "sent" | "failed" | "pending";

export interface DeliveryReceipt {
  contactLabel: string;
  channel: "email" | "sms";
  status: DeliveryStatus;
  detail?: string;
}

export interface ContactRecipient {
  label: string;
  email: string | null;
  phone: string | null;
}

/// Send a notification to a single confirmed contact, honoring TRUSTED_CONTACT_CHANNEL
/// and falling through to email if SMS is requested but Twilio creds aren't configured.
export async function notifyContact(c: ContactRecipient, subject: string, body: string): Promise<DeliveryReceipt[]> {
  const receipts: DeliveryReceipt[] = [];
  const channel = env.TRUSTED_CONTACT_CHANNEL;

  if ((channel === "sms" || channel === "both") && c.phone) {
    const r = await sendSms(c.phone, `${subject}\n${body}`);
    if (r.ok) {
      receipts.push({ contactLabel: c.label, channel: "sms", status: "sent" });
    } else if (r.skipped) {
      // Fall through to email per spec ("warn at startup" — handled in env validation).
      if (c.email) {
        const er = await sendEmail(c.email, subject, body);
        receipts.push({ contactLabel: c.label, channel: "email", status: er.ok ? "sent" : "failed" });
      } else {
        receipts.push({ contactLabel: c.label, channel: "sms", status: "failed", detail: "sms_provider_not_configured_and_no_email" });
      }
    } else {
      receipts.push({ contactLabel: c.label, channel: "sms", status: "failed", detail: `sms_${r.status}` });
    }
  }

  if ((channel === "email" || channel === "both") && c.email && !receipts.some((r) => r.channel === "email")) {
    const er = await sendEmail(c.email, subject, body);
    receipts.push({ contactLabel: c.label, channel: "email", status: er.ok ? "sent" : "failed" });
  }

  if (receipts.length === 0) {
    receipts.push({ contactLabel: c.label, channel: c.email ? "email" : "sms", status: "failed", detail: "no_channel_available" });
  }
  return receipts;
}
