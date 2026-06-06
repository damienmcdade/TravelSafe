import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/http";
import { CheckInStatus } from "@/generated/prisma/client";
import { getConfirmedContacts } from "../contacts";
import { notifyContact, type DeliveryReceipt } from "../notifications";

export async function armCheckIn(
  userId: string,
  opts: { durationMinutes: number; message?: string; lat?: number; lng?: number; contactIds?: string[] },
) {
  if (opts.durationMinutes < 1 || opts.durationMinutes > 240) {
    throw new HttpError(400, "duration_out_of_range", "Duration must be 1–240 minutes");
  }
  const confirmed = await getConfirmedContacts(userId);
  if (confirmed.length === 0) {
    // Per spec: warn but allow — the user may want a personal-only timer.
    // The UI must surface "no confirmed contacts" loudly before this point.
  }
  // Restrict the requested selection to THIS user's confirmed contacts, so a
  // stale/foreign id can't slip through and an unconfirmed contact is never
  // alerted. Empty result (incl. "select all") persists as [] = notify all.
  const confirmedIds = new Set(confirmed.map((c) => c.id));
  const notifyContactIds = (opts.contactIds ?? []).filter((id) => confirmedIds.has(id));
  const timer = await prisma.checkInTimer.create({
    data: {
      userId,
      scheduledFor: new Date(Date.now() + opts.durationMinutes * 60_000),
      message: opts.message,
      cancelToken: crypto.randomBytes(20).toString("base64url"),
      lastLat: opts.lat,
      lastLng: opts.lng,
      notifyContactIds,
    },
  });
  return { id: timer.id, scheduledFor: timer.scheduledFor, confirmedContactCount: confirmed.length };
}

export async function markSafe(userId: string, timerId: string) {
  const timer = await prisma.checkInTimer.findFirst({ where: { id: timerId, userId } });
  if (!timer) throw new HttpError(404, "not_found");
  if (timer.status !== CheckInStatus.ACTIVE) return { ok: true, alreadyResolved: true };
  await prisma.checkInTimer.update({
    where: { id: timer.id },
    // v92 — clear lastLat/lastLng on resolution per the privacy
    // policy promise: "the last latitude/longitude you shared to
    // that timer" only exists for the lifetime of the timer.
    // Pre-v92 the coords survived until account-delete, which
    // contradicted the user-facing copy.
    data: { status: CheckInStatus.CANCELLED, lastLat: null, lastLng: null },
  });
  return { ok: true };
}

export async function listActive(userId: string) {
  return prisma.checkInTimer.findMany({
    where: { userId, status: CheckInStatus.ACTIVE },
    orderBy: { scheduledFor: "asc" },
  });
}

/// Called by the worker when a timer fires without being cancelled.
export async function triggerExpiry(timerId: string): Promise<DeliveryReceipt[]> {
  const timer = await prisma.checkInTimer.findUnique({ where: { id: timerId } });
  if (!timer || timer.status !== CheckInStatus.ACTIVE) return [];
  const allConfirmed = await getConfirmedContacts(timer.userId);
  // Honor the user's pick from the arm dialog: a non-empty notifyContactIds
  // restricts the alert to those contacts; empty = notify everyone.
  const confirmed =
    timer.notifyContactIds.length > 0
      ? allConfirmed.filter((c) => timer.notifyContactIds.includes(c.id))
      : allConfirmed;

  const subject = "CommunitySafe — a contact didn't check in";
  const location =
    timer.lastLat != null && timer.lastLng != null
      ? `Last known location: https://www.google.com/maps?q=${timer.lastLat},${timer.lastLng}`
      : "Last known location: unavailable";
  const note = timer.message ? `\nUser note: ${timer.message}` : "";
  const body = `Your contact set a CommunitySafe check-in timer that just expired without confirmation. They may need help.\n\n${location}${note}\n\nThis is an automated notification.`;

  const receipts: DeliveryReceipt[] = [];
  for (const c of confirmed) {
    const r = await notifyContact(c, subject, body);
    receipts.push(...r);
  }

  await prisma.checkInTimer.update({
    where: { id: timer.id },
    data: { status: CheckInStatus.TRIGGERED, triggeredAt: new Date() },
  });
  return receipts;
}
