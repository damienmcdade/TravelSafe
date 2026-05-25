import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ReviewActionKind } from "@prisma/client";
import { requireAuth } from "../middleware/auth.js";
import { writeLimiter } from "../middleware/rate-limit.js";
import { HttpError } from "../middleware/error.js";
import { env } from "../env.js";
import { listPendingPosts, reportPost, reviewPost } from "../services/moderation/queue.service.js";

export const moderationRouter = Router();

// MVP authorization: any user whose email is in MODERATOR_EMAILS env var is a
// moderator. TODO: real role table / RBAC.
function requireModerator(req: Request) {
  const email = req.session?.email;
  const list = (env.MODERATOR_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!email || !list.includes(email.toLowerCase())) {
    throw new HttpError(403, "moderator_only");
  }
}

moderationRouter.get("/queue", requireAuth, async (req, res, next) => {
  try {
    requireModerator(req);
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
    requireModerator(req);
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
