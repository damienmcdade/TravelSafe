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
    await prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { userId: req.session!.uid, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      update: { userId: req.session!.uid, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
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
