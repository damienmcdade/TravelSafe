import crypto from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../middleware/error.js";
import { CheckInStatus } from "@prisma/client";
import { getConfirmedContacts } from "../contacts.service.js";
import { notifyContact, type DeliveryReceipt } from "../notifications/index.js";

export async function armCheckIn(userId: string, opts: { durationMinutes: number; message?: string; lat?: number; lng?: number }) {
  if (opts.durationMinutes < 1 || opts.durationMinutes > 240) {
    throw new HttpError(400, "duration_out_of_range", "Duration must be 1–240 minutes");
  }
  const confirmed = await getConfirmedContacts(userId);
  if (confirmed.length === 0) {
    // Per spec: warn but allow — the user may want a personal-only timer.
    // The UI must surface "no confirmed contacts" loudly before this point.
  }
  const timer = await prisma.checkInTimer.create({
    data: {
      userId,
      scheduledFor: new Date(Date.now() + opts.durationMinutes * 60_000),
      message: opts.message,
      cancelToken: crypto.randomBytes(20).toString("base64url"),
      lastLat: opts.lat,
      lastLng: opts.lng,
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
    data: { status: CheckInStatus.CANCELLED },
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
///
/// v96 — atomic claim. The prior implementation read the timer with
/// findUnique, checked status === ACTIVE in JS, then fanned out
/// notifications, then updated to TRIGGERED. Two concurrent worker
/// ticks (cross-container races or a stuck tick + next tick firing)
/// both passed the check and both notified the trusted contact list.
/// Family received the "didn't check in" SMS / email twice. The fix
/// uses Prisma updateMany with status=ACTIVE in the WHERE clause —
/// only the first caller's UPDATE matches the row and gets count===1;
/// concurrent callers get count===0 and return immediately.
export async function triggerExpiry(timerId: string): Promise<DeliveryReceipt[]> {
  const triggeredAt = new Date();
  const claim = await prisma.checkInTimer.updateMany({
    where: { id: timerId, status: CheckInStatus.ACTIVE },
    data: { status: CheckInStatus.TRIGGERED, triggeredAt },
  });
  if (claim.count === 0) return [];
  const timer = await prisma.checkInTimer.findUnique({ where: { id: timerId } });
  if (!timer) return [];
  const confirmed = await getConfirmedContacts(timer.userId);

  const subject = "TravelSafe — a contact didn't check in";
  const location =
    timer.lastLat != null && timer.lastLng != null
      ? `Last known location: https://www.google.com/maps?q=${timer.lastLat},${timer.lastLng}`
      : "Last known location: unavailable";
  const note = timer.message ? `\nUser note: ${timer.message}` : "";
  const body = `Your contact set a TravelSafe check-in timer that just expired without confirmation. They may need help.\n\n${location}${note}\n\nThis is an automated notification.`;

  const receipts: DeliveryReceipt[] = [];
  for (const c of confirmed) {
    const r = await notifyContact(c, subject, body);
    receipts.push(...r);
  }
  return receipts;
}
