import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../lib/http";
import { sendEmail } from "../notifications/email";
import { env } from "../../lib/env";

function buildShareUrl(token: string) {
  const base = env.LIVE_SHARE_BASE_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/share/${token}`;
}

export async function createLiveShare(userId: string, opts: { durationMinutes: number; contactEmail?: string }) {
  if (opts.durationMinutes < 5 || opts.durationMinutes > 240) {
    throw new HttpError(400, "duration_out_of_range", "Duration must be 5–240 minutes");
  }
  const token = crypto.randomBytes(20).toString("base64url");
  const expiresAt = new Date(Date.now() + opts.durationMinutes * 60_000);
  const link = await prisma.liveShareLink.create({
    data: { userId, token, expiresAt },
  });
  if (opts.contactEmail) {
    await sendEmail(
      opts.contactEmail,
      "TravelSafe — your contact is sharing their location",
      `A TravelSafe user is sharing their live location with you until ${expiresAt.toISOString()}.\n\nOpen: ${buildShareUrl(token)}\n\nThe link will stop working at expiry, or sooner if revoked.`,
    );
  }
  return { id: link.id, token, expiresAt, shareUrl: buildShareUrl(token) };
}

export async function revokeLiveShare(userId: string, id: string) {
  const result = await prisma.liveShareLink.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
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

export async function resolveSharedView(token: string) {
  const link = await prisma.liveShareLink.findUnique({ where: { token } });
  if (!link) throw new HttpError(404, "not_found");
  if (link.revokedAt) throw new HttpError(410, "revoked");
  if (link.expiresAt < new Date()) throw new HttpError(410, "expired");
  return { expiresAt: link.expiresAt, userId: link.userId };
}
