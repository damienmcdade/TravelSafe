import { Router } from "express";
import { z } from "zod";
import webpush from "web-push";
import { prisma } from "../lib/prisma.js";
import { env } from "../env.js";
import { requireAuth } from "../middleware/auth.js";
import { writeLimiter } from "../middleware/rate-limit.js";

export const pushRouter = Router();

if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
}

pushRouter.get("/public-key", (_req, res) => {
  res.json({ publicKey: env.VAPID_PUBLIC_KEY ?? null });
});

const subscribeBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

pushRouter.post("/subscribe", requireAuth, writeLimiter, async (req, res, next) => {
  try {
    const sub = subscribeBody.parse(req.body);
    const uid = req.session!.uid;
    // fix(audit security BOLA): the upsert keys on the @unique `endpoint`. The
    // prior `update` set `userId`, so an authenticated caller (any anonymous
    // session qualifies) could POST a victim's endpoint and silently re-point
    // that subscription to themselves — hijacking the victim's push channel.
    // Mirror the canonical web route: reject a cross-account endpoint with 409
    // and NEVER reassign ownership on update.
    const existing = await prisma.pushSubscription.findUnique({
      where: { endpoint: sub.endpoint },
      select: { userId: true },
    });
    if (existing && existing.userId !== uid) {
      return res.status(409).json({ error: "endpoint_in_use" });
    }
    await prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { userId: uid, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      update: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

pushRouter.delete("/subscribe", requireAuth, writeLimiter, async (req, res, next) => {
  try {
    const { endpoint } = z.object({ endpoint: z.string().url() }).parse(req.body);
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.session!.uid } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
