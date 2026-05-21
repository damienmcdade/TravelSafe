import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/http";
import { sendEmail } from "./notifications/email";
import { env } from "../lib/env";

const MAX_CONTACTS = 5;

function buildConfirmUrl(token: string) {
  const base = env.LIVE_SHARE_BASE_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/contacts/confirm/${token}`;
}

export async function listContacts(userId: string) {
  return prisma.trustedContact.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true, email: true, phone: true, status: true, confirmedAt: true, confirmationSentAt: true },
  });
}

export async function addContact(userId: string, input: { label: string; email?: string | null; phone?: string | null }) {
  if (!input.email && !input.phone) throw new HttpError(400, "email_or_phone_required");
  const count = await prisma.trustedContact.count({ where: { userId } });
  if (count >= MAX_CONTACTS) throw new HttpError(409, "contact_limit_reached", `Max ${MAX_CONTACTS} contacts`);

  const token = crypto.randomBytes(24).toString("base64url");
  const contact = await prisma.trustedContact.create({
    data: {
      userId,
      label: input.label,
      email: input.email ?? null,
      phone: input.phone ?? null,
      confirmationToken: token,
      confirmationSentAt: new Date(),
    },
  });

  if (contact.email) {
    await sendEmail(
      contact.email,
      "TravelSafe — please confirm you can receive safety alerts",
      `Someone added you as a trusted contact on TravelSafe.\n\n` +
        `If you agree to receive check-in and live-share notifications from them,\n` +
        `confirm here: ${buildConfirmUrl(token)}\n\n` +
        `If you don't recognize this, ignore this email — you will not be contacted further.`,
    );
  }
  return { id: contact.id, status: contact.status };
}

export async function confirmContact(token: string) {
  const contact = await prisma.trustedContact.findUnique({ where: { confirmationToken: token } });
  if (!contact) throw new HttpError(404, "invalid_token");
  if (contact.status === "CONFIRMED") return { ok: true, alreadyConfirmed: true };
  await prisma.trustedContact.update({
    where: { id: contact.id },
    data: { status: "CONFIRMED", confirmedAt: new Date(), confirmationToken: null },
  });
  return { ok: true };
}

export async function resendConfirmation(userId: string, contactId: string) {
  const contact = await prisma.trustedContact.findFirst({ where: { id: contactId, userId } });
  if (!contact) throw new HttpError(404, "not_found");
  if (contact.status === "CONFIRMED") throw new HttpError(409, "already_confirmed");
  const token = crypto.randomBytes(24).toString("base64url");
  const updated = await prisma.trustedContact.update({
    where: { id: contact.id },
    data: { confirmationToken: token, confirmationSentAt: new Date() },
  });
  if (updated.email) {
    await sendEmail(
      updated.email,
      "TravelSafe — confirmation re-sent",
      `Confirm here: ${buildConfirmUrl(token)}`,
    );
  }
  return { ok: true };
}

export async function removeContact(userId: string, contactId: string) {
  const result = await prisma.trustedContact.deleteMany({ where: { id: contactId, userId } });
  if (result.count === 0) throw new HttpError(404, "not_found");
  return { ok: true };
}

export async function getConfirmedContacts(userId: string) {
  return prisma.trustedContact.findMany({
    where: { userId, status: "CONFIRMED" },
    select: { id: true, label: true, email: true, phone: true },
  });
}
