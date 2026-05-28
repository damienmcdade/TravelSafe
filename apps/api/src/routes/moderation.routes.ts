import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ReviewActionKind, TrustLevel } from "@prisma/client";
import { requireAuth } from "../middleware/auth.js";
import { writeLimiter } from "../middleware/rate-limit.js";
import { HttpError } from "../middleware/error.js";
import { env } from "../env.js";
import { listPendingPosts, reportPost, reviewPost } from "../services/moderation/queue.service.js";
import { writeSecurityAudit } from "../lib/audit.js";

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
  // v96 — audit flagged a stale-env risk: if every MODERATOR is
  // demoted (offboarding, accidental update), the count drops to 0
  // and the CSV path re-activates indefinitely, granting access to
  // anyone still listed in MODERATOR_EMAILS. Add a grace window
  // measured from boot: 24 h after the process starts, we stop
  // trusting the CSV even at count=0 and force a deploy to recover.
  // Bootstrap on a fresh install still has the full window to
  // promote the first moderator.
  const moderatorCount = await prisma.user.count({ where: { trustLevel: TrustLevel.MODERATOR } });
  if (moderatorCount > 0) throw new HttpError(403, "moderator_only");
  if (Date.now() - BOOT_TIME > BOOTSTRAP_GRACE_MS) {
    throw new HttpError(403, "moderator_bootstrap_window_closed");
  }
  const list = (env.MODERATOR_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!list.includes((user.email ?? "").toLowerCase())) {
    throw new HttpError(403, "moderator_only");
  }
}

const BOOT_TIME = Date.now();
const BOOTSTRAP_GRACE_MS = 24 * 60 * 60 * 1000;

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
    const postId = req.params.id as string;
    const result = await reviewPost(req.session!.uid, postId, body.action, body);
    // v93p7 — emit audit event (DISA STIG AU-2 / AU-3).
    writeSecurityAudit({
      event: "moderation.review",
      userId: req.session!.uid,
      email: req.session!.email,
      req,
      detail: { postId, action: body.action, reason: body.reason ?? null },
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

moderationRouter.post("/posts/:id/report", requireAuth, writeLimiter, async (req, res, next) => {
  try {
    const body = z.object({ reason: z.string().max(500).optional() }).parse(req.body ?? {});
    res.json(await reportPost(req.session!.uid, req.params.id as string, body.reason));
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
    writeSecurityAudit({ event: "moderation.suspend", userId: blockerId, email: req.session!.email, req, detail: { action: "block", targetUserId: userId } });
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
