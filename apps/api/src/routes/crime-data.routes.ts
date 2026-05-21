import { Router } from "express";
import { z } from "zod";
import { optionalAuth } from "../middleware/auth.js";
import { crimeData } from "../services/crime-data/index.js";
import { nearestArea } from "../services/crime-data/neighborhoods.js";

export const crimeDataRouter = Router();

const areaQuery = z.object({
  neighborhood: z.string().optional(),
  jurisdiction: z.string().optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
});

function resolveArea(q: z.infer<typeof areaQuery>): string | null {
  if (q.neighborhood) return q.neighborhood;
  if (q.jurisdiction) return q.jurisdiction;
  if (q.lat != null && q.lng != null) {
    const a = nearestArea({ lat: q.lat, lng: q.lng });
    return a?.slug ?? null;
  }
  return null;
}

crimeDataRouter.get("/citywide", optionalAuth, async (_req, res, next) => {
  try {
    res.json(await crimeData.getCitywide());
  } catch (err) {
    next(err);
  }
});

crimeDataRouter.get("/alerts", optionalAuth, async (req, res, next) => {
  try {
    const q = areaQuery.parse(req.query);
    const area = resolveArea(q);
    if (!area) return res.status(400).json({ error: "area_required" });
    res.json({ area, alerts: await crimeData.getAreaAlerts(area, { limit: q.limit }) });
  } catch (err) {
    next(err);
  }
});

crimeDataRouter.get("/area-stats", optionalAuth, async (req, res, next) => {
  try {
    const q = areaQuery.parse(req.query);
    const area = resolveArea(q);
    if (!area) return res.status(400).json({ error: "area_required" });
    res.json(await crimeData.getAreaStats(area));
  } catch (err) {
    next(err);
  }
});

crimeDataRouter.get("/insights", optionalAuth, async (req, res, next) => {
  try {
    const q = areaQuery.parse(req.query);
    const area = resolveArea(q);
    if (!area) return res.status(400).json({ error: "area_required" });
    const { getAreaInsights } = await import("../services/crime-data/insights.service.js");
    res.json(await getAreaInsights(area));
  } catch (err) {
    next(err);
  }
});

crimeDataRouter.get("/recent", optionalAuth, async (req, res, next) => {
  try {
    const q = areaQuery.parse(req.query);
    const area = resolveArea(q);
    if (!area) return res.status(400).json({ error: "area_required" });
    res.json({ area, reports: await crimeData.getRecentReports(area, { limit: q.limit }) });
  } catch (err) {
    next(err);
  }
});
