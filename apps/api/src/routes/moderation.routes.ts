import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ReviewActionKind, TrustLevel } from "@prisma/client";
import { requireAuth } from "../middleware/auth.js";
import { writeLimiter } from "../middleware/rate-limit.js";
import { HttpError } from "../middleware/error.js";
import { env } from "../env.js";
import { listPendingPosts, reportPost, reviewPost } from "../services/moderation/queue.service.js";

export const moderationRouter = Router();

// v93p2 — real RBAC. Pre-v93p2 moderator authz was a CSV env var matched
// against the session email (DISA STIG AC-2 / AC-3 finding). Now we
// check User.trustLevel === MODERATOR which is already in the schema
// and managed by the trust-recompute job + manual promotions. The
// MODERATOR_EMAILS env var is retained as a BOOTSTRAP path so the
// initial seed account can promote itself — once promoted, the
// trustLevel check is canonical and env can be unset.
async function requireModerator(req: Request): Promise<void> {
  const uid = req.session?.uid;
  if (!uid) throw new HttpError(403, "moderator_only");
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { trustLevel: true, email: true, suspendedUntil: true, permanentlyBanned: true },
  });
  if (!user) throw new HttpError(403, "moderator_only");
  if (user.permanentlyBanned || (user.suspendedUntil && user.suspendedUntil > new Date())) {
    throw new HttpError(403, "moderator_only");
  }
  if (user.trustLevel === TrustLevel.MODERATOR) return;
  // Bootstrap fallback — env-CSV check is honored ONLY while the
  // role table has zero MODERATOR rows. Once a real moderator exists
  // we stop trusting the env var (prevents drift if a deploy forgets
  // to unset MODERATOR_EMAILS after seeding).
  const moderatorCount = await prisma.user.count({ where: { trustLevel: TrustLevel.MODERATOR } });
  if (moderatorCount > 0) throw new HttpError(403, "moderator_only");
  const list = (env.MODERATOR_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!list.includes((user.email ?? "").toLowerCase())) {
    throw new HttpError(403, "moderator_only");
  }
}

moderationRouter.get("/queue", requireAuth, async (req, res, next) => {
  try {
    await requireModerator(req);
    res.json(await listPendingPosts());
  } catch (err) {
    next(err);
  }
});

const reviewBody = z.object({
  action: z.nativeEnum(ReviewActionKind),
  reason: z.string().max(500).optional(),
  confirmedAreaLevelAndAnonymized: z.boolean().optional(),
});

moderationRouter.post("/posts/:id/review", requireAuth, async (req, res, next) => {
  try {
    await requireModerator(req);
    const body = reviewBody.parse(req.body);
    res.json(await reviewPost(req.session!.uid, req.params.id, body.action, body));
  } catch (err) {
    next(err);
  }
});

moderationRouter.post("/posts/:id/report", requireAuth, writeLimiter, async (req, res, next) => {
  try {
    const body = z.object({ reason: z.string().max(500).optional() }).parse(req.body ?? {});
    res.json(await reportPost(req.session!.uid, req.params.id, body.reason));
  } catch (err) {
    next(err);
  }
});

moderationRouter.post("/block", requireAuth, writeLimiter, async (req, res, next) => {
  try {
    const { userId } = z.object({ userId: z.string() }).parse(req.body);
    const blockerId = req.session!.uid;
    if (userId === blockerId) throw new HttpError(400, "cannot_block_self");
    await prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId: userId } },
      create: { blockerId, blockedId: userId },
      update: {},
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

moderationRouter.post("/mute", requireAuth, writeLimiter, async (req, res, next) => {
  try {
    const { userId } = z.object({ userId: z.string() }).parse(req.body);
    const muterId = req.session!.uid;
    if (userId === muterId) throw new HttpError(400, "cannot_mute_self");
    await prisma.userMute.upsert({
      where: { muterId_mutedId: { muterId, mutedId: userId } },
      create: { muterId, mutedId: userId },
      update: {},
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
