import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { writeLimiter } from "../middleware/rate-limit.js";
import { armCheckIn, listActive, markSafe } from "../services/safety/check-in.service.js";
import { createLiveShare, listLiveShares, revokeLiveShare } from "../services/safety/live-share.service.js";

export const safetyRouter = Router();

// --- Check-in --------------------------------------------------------------

const armBody = z.object({
  durationMinutes: z.number().int().min(1).max(240),
  message: z.string().max(200).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

safetyRouter.post("/check-in", requireAuth, writeLimiter, async (req, res, next) => {
  try {
    res.status(201).json(await armCheckIn(req.session!.uid, armBody.parse(req.body)));
  } catch (err) {
    next(err);
  }
});

safetyRouter.post("/check-in/:id/safe", requireAuth, writeLimiter, async (req, res, next) => {
  try {
    res.json(await markSafe(req.session!.uid, req.params.id as string));
  } catch (err) {
    next(err);
  }
});

safetyRouter.get("/check-in/active", requireAuth, async (req, res, next) => {
  try {
    res.json(await listActive(req.session!.uid));
  } catch (err) {
    next(err);
  }
});

// --- Live share ------------------------------------------------------------

const liveShareBody = z.object({
  durationMinutes: z.number().int().min(5).max(240),
  contactEmail: z.string().email().optional(),
});

safetyRouter.post("/live-share", requireAuth, writeLimiter, async (req, res, next) => {
  try {
    res.status(201).json(await createLiveShare(req.session!.uid, liveShareBody.parse(req.body)));
  } catch (err) {
    next(err);
  }
});

safetyRouter.delete("/live-share/:id", requireAuth, writeLimiter, async (req, res, next) => {
  try {
    res.json(await revokeLiveShare(req.session!.uid, req.params.id as string));
  } catch (err) {
    next(err);
  }
});

safetyRouter.get("/live-share", requireAuth, async (req, res, next) => {
  try {
    res.json(await listLiveShares(req.session!.uid));
  } catch (err) {
    next(err);
  }
});

// --- Safe route ------------------------------------------------------------
// Removed: the legacy POST /safety/safe-route stub (planSafeRoute) was a
// straight-line, San-Diego-only, centroid-based placeholder. It is fully
// superseded by the real routing engine in the web app
// (apps/web/src/server/services/route/safe-route.ts → GET /api/route/safe),
// which does OpenRouteService/OSRM polyline routing + per-neighborhood
// exposure scoring across all supported cities. No client called this route.
