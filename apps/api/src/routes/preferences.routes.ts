import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { CrimeCategory, NotificationFrequency } from "../generated/prisma/client";

export const preferencesRouter = Router();

// Hard ceiling on real-time pushes per day, regardless of user preference.
// Prevents notification fatigue even if a user opts into REAL_TIME with a
// high cap.
const REAL_TIME_HARD_CEILING = 10;

const alertsBody = z.object({
  categories: z.array(z.nativeEnum(CrimeCategory)).min(0).max(3),
  pushMinRiskLevel: z.number().int().min(1).max(5).default(3),
  notificationFrequency: z.nativeEnum(NotificationFrequency).default(NotificationFrequency.DIGEST_DAILY),
  notificationDailyCap: z.number().int().min(1).max(REAL_TIME_HARD_CEILING).default(3),
});

preferencesRouter.get("/alerts", requireAuth, async (req, res, next) => {
  try {
    const pref = await prisma.alertPreference.findUnique({ where: { userId: req.session!.uid } });
    res.json(pref ?? { categories: [], pushMinRiskLevel: 3 });
  } catch (err) {
    next(err);
  }
});

preferencesRouter.put("/alerts", requireAuth, async (req, res, next) => {
  try {
    const data = alertsBody.parse(req.body);
    const userId = req.session!.uid;
    const pref = await prisma.alertPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    res.json(pref);
  } catch (err) {
    next(err);
  }
});
