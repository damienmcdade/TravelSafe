import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/http";
import { sendEmail } from "../notifications/email";
import { sendSms } from "../notifications/sms";
import { publicBaseUrl } from "../../lib/base-url";

function buildShareUrl(token: string) {
  return `${publicBaseUrl()}/share/${token}`;
}

// v47 — classify the contact field as email, phone, or unknown so
// the same input box accepts either. "alice@example.com" → email;
// "+14155551212" / "(415) 555-1212" / "4155551212" → phone
// (normalized to E.164 for Twilio).
function classifyContact(raw: string): { kind: "email" | "phone" | "unknown"; value: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "unknown", value: trimmed };
  if (trimmed.includes("@")) return { kind: "email", value: trimmed };
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (/^\+?\d{7,15}$/.test(digits)) {
    const e164 = digits.startsWith("+")
      ? digits
      : (digits.length === 10 ? `+1${digits}` : `+${digits}`);
    return { kind: "phone", value: e164 };
  }
  return { kind: "unknown", value: trimmed };
}

export async function createLiveShare(
  userId: string,
  opts: { durationMinutes: number; contact?: string; contactEmail?: string; lat?: number; lng?: number },
) {
  if (opts.durationMinutes < 5 || opts.durationMinutes > 240) {
    throw new HttpError(400, "duration_out_of_range", "Duration must be 5–240 minutes");
  }
  const token = crypto.randomBytes(20).toString("base64url");
  const expiresAt = new Date(Date.now() + opts.durationMinutes * 60_000);
  // v113 — seed the share with the sharer's starting position when the browser
  // provided one; the device then keeps it fresh via the heartbeat endpoint.
  const hasStart = Number.isFinite(opts.lat) && Number.isFinite(opts.lng);
  const link = await prisma.liveShareLink.create({
    data: {
      userId, token, expiresAt,
      ...(hasStart ? { lastLat: opts.lat, lastLng: opts.lng, lastLocationAt: new Date() } : {}),
    },
  });
  // v47 — delivery status now surfaced to UI. Prior code awaited
  // sendEmail without checking its result; the nodemailer
  // jsonTransport fallback (used when SMTP_URL is unset) silently
  // swallowed every message → users got 201 back with nothing
  // actually sent. That's the "links not sending to inputted email"
  // complaint.
  let delivery: { kind: "email" | "phone" | null; sent: boolean; reason?: string } = {
    kind: null,
    sent: false,
  };
  // contactEmail (legacy field) + contact (v47 unified) both accepted.
  const contactRaw = (opts.contact ?? opts.contactEmail ?? "").trim();
  if (contactRaw) {
    const c = classifyContact(contactRaw);
    const url = buildShareUrl(token);
    // v113 — live coordinate streaming now ships: the recipient page renders the
    // sharer's location on a map and auto-refreshes as their device sends
    // heartbeats. Copy updated to match (it no longer over-/under-promises).
    const msg =
      `CommunitySafe: your contact has started sharing their LIVE location with you, ` +
      `active until ${expiresAt.toLocaleString()}. ` +
      `Open ${url} to follow them on a map — it updates as their device moves and ` +
      `stops working at expiry, or sooner if they revoke it. ` +
      `In an emergency, contact local authorities directly.`;
    const subject = "CommunitySafe — your contact is sharing their live location";
    if (c.kind === "email") {
      const r = await sendEmail(c.value, subject, msg);
      delivery = { kind: "email", sent: r.ok, reason: r.reason };
    } else if (c.kind === "phone") {
      const r = await sendSms(c.value, msg);
      delivery = {
        kind: "phone",
        sent: r.ok,
        reason: r.skipped ? "sms_not_configured" : r.status ? `status_${r.status}` : undefined,
      };
    } else {
      delivery = { kind: null, sent: false, reason: "contact_not_recognized" };
    }
  }
  return { id: link.id, token, expiresAt, shareUrl: buildShareUrl(token), delivery };
}

export async function revokeLiveShare(userId: string, id: string) {
  const result = await prisma.liveShareLink.updateMany({
    where: { id, userId, revokedAt: null },
    // fix(audit liveshare-coord-retention): null the last broadcast position on
    // revoke so precise location is "retained only for the duration of an active
    // session" as the privacy policy promises — mirroring markSafe() for check-ins.
    data: { revokedAt: new Date(), lastLat: null, lastLng: null, lastLocationAt: null },
  });
  if (result.count === 0) throw new HttpError(404, "not_found_or_already_revoked");
  return { ok: true };
}

export async function listLiveShares(userId: string) {
  return prisma.liveShareLink.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, token: true, expiresAt: true, revokedAt: true, createdAt: true },
  });
}

// v113 — the sharer's device POSTs its current position here on a heartbeat
// (browser geolocation watch). Updates EVERY active (non-revoked, non-expired)
// share the user has, so one device update fans out to all their open links.
export async function updateLiveShareLocation(userId: string, lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new HttpError(400, "invalid_coordinates");
  }
  const now = new Date();
  const result = await prisma.liveShareLink.updateMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    data: { lastLat: lat, lastLng: lng, lastLocationAt: now },
  });
  return { updated: result.count };
}

// fix(legal liveshare-expiry-coord-retention): the privacy policy promises the
// sharer's precise location is cleared when a link is revoked OR EXPIRES, and
// that coordinates are "retained only for the duration of an active session."
// revokeLiveShare() already nulls coords; expiry did NOT, so an expired row kept
// lastLat/lastLng/lastLocationAt at rest indefinitely — contradicting the policy
// (FTC §5 / CCPA minimization) and leaving stale precise location if breached.
// This sweep nulls coords on every expired, not-yet-cleared link; it's wired into
// the daily purge-accounts cron. Idempotent (the WHERE excludes already-nulled
// rows) and bounded by the natural count of expired links.
export async function clearExpiredLiveShareLocations(): Promise<{ cleared: number }> {
  const result = await prisma.liveShareLink.updateMany({
    where: {
      expiresAt: { lt: new Date() },
      OR: [{ lastLat: { not: null } }, { lastLng: { not: null } }, { lastLocationAt: { not: null } }],
    },
    data: { lastLat: null, lastLng: null, lastLocationAt: null },
  });
  return { cleared: result.count };
}

export async function resolveSharedView(token: string) {
  const link = await prisma.liveShareLink.findUnique({ where: { token } });
  if (!link) throw new HttpError(404, "not_found");
  if (link.revokedAt) throw new HttpError(410, "revoked");
  if (link.expiresAt < new Date()) {
    // Defense-in-depth: lazily null coords the moment an expired link is touched,
    // so the policy holds even between the daily sweep runs. Best-effort.
    if (link.lastLat != null || link.lastLng != null || link.lastLocationAt != null) {
      void prisma.liveShareLink
        .update({ where: { token }, data: { lastLat: null, lastLng: null, lastLocationAt: null } })
        .catch(() => {});
    }
    throw new HttpError(410, "expired");
  }
  // fix(audit loc-share-userid-leak-2): the public, token-only share endpoint
  // must NOT leak the sharer's internal userId (cuid). Return only the public
  // view: expiry + the latest broadcast position (null until the first heartbeat).
  return {
    expiresAt: link.expiresAt,
    lat: link.lastLat ?? null,
    lng: link.lastLng ?? null,
    locationAt: link.lastLocationAt ? link.lastLocationAt.toISOString() : null,
  };
}
