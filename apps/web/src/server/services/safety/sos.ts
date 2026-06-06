import "server-only";
import { getConfirmedContacts } from "../contacts";
import { notifyContact, type DeliveryReceipt } from "../notifications";
import { createLiveShare } from "./live-share";
import { HttpError } from "../../lib/http";

// One-tap SOS / panic — the personal-safety "send help now" action.
//
// This is a Citizen-Protect-style emergency escalation built ENTIRELY on the
// pieces CommunitySafe already has (live-share + trusted contacts + the email/
// SMS notifier) — no live agent / call-center. A single tap:
//   1. opens a live-share session (so contacts have a durable link), and
//   2. IMMEDIATELY notifies every confirmed trusted contact with an urgent
//      message, the share link, and a map pin of where the user was when they
//      hit SOS.
// It deliberately does NOT call 911 — the UI always points at tel:911 for true
// emergencies; SOS is the "tell the people who care about me, right now" layer.

const DEFAULT_DURATION_MIN = 120;

export interface SosResult {
  shareUrl: string;
  expiresAt: Date;
  mapUrl: string | null;
  contactsNotified: number;
  receipts: DeliveryReceipt[];
}

export async function triggerSos(
  userId: string,
  opts: { lat?: number; lng?: number; message?: string; durationMinutes?: number } = {},
): Promise<SosResult> {
  const contacts = await getConfirmedContacts(userId);
  if (contacts.length === 0) {
    throw new HttpError(
      400,
      "no_confirmed_contacts",
      "Add and confirm at least one trusted contact before you can send an SOS.",
    );
  }

  const durationMinutes = Math.min(240, Math.max(5, opts.durationMinutes ?? DEFAULT_DURATION_MIN));
  const hasLoc = typeof opts.lat === "number" && typeof opts.lng === "number";
  const mapUrl = hasLoc ? `https://maps.google.com/?q=${opts.lat},${opts.lng}` : null;

  // Open a live-share session (no inline contact — we fan out to ALL contacts
  // below). createLiveShare handles token + expiry + the /share link. Seed it
  // with the SOS location so the recipient's live map shows a pin immediately,
  // then the sharer's device keeps it current via the heartbeat.
  const share = await createLiveShare(userId, {
    durationMinutes,
    ...(hasLoc ? { lat: opts.lat, lng: opts.lng } : {}),
  });

  const note = (opts.message ?? "").trim();
  const subject = "🚨 CommunitySafe SOS — your contact may need help";
  const body =
    `A CommunitySafe contact just triggered an SOS and asked to alert you right now.\n\n` +
    (note ? `Their message: "${note}"\n\n` : "") +
    (mapUrl ? `Location when they sent it: ${mapUrl}\n` : "") +
    // v113: the Live Share link now shows the sender's LIVE location on a map that
    // updates as their device sends positions (no longer a static session link).
    `Live location link (active until ${share.expiresAt.toLocaleString()}) — follow them on a map: ${share.shareUrl}\n\n` +
    `If you can't reach them and believe they are in danger, call 911.\n` +
    `This is an automated message sent at their request.`;

  // Notify every confirmed contact in parallel. fix(audit sos-fanout-abort):
  // allSettled (not all) so one contact's hard failure can never abort the
  // rest — for a panic fan-out, every other contact MUST still be tried.
  const settled = await Promise.allSettled(
    contacts.map((c) => notifyContact({ label: c.label, email: c.email, phone: c.phone }, subject, body)),
  );
  const receipts = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  return {
    shareUrl: share.shareUrl,
    expiresAt: share.expiresAt,
    mapUrl,
    contactsNotified: contacts.length,
    receipts,
  };
}
