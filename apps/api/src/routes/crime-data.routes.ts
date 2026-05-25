import { Router } from "express";
import { z } from "zod";
import { optionalAuth } from "../middleware/auth.js";
import { crimeData } from "../services/crime-data/index.js";
import { nearestArea } from "../services/crime-data/neighborhoods.js";
import { getCrimeMix, getCitywideCrimeMix } from "@travelsafe/crime-data/mix";
import { getCitywideUpticks } from "@travelsafe/crime-data/upticks";

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

// Added in v36 — mix + upticks port from apps/web. Same response shape
// as the Vercel handlers at /api/crime-data/mix and /api/crime-data/upticks.
// Implementation lives in @travelsafe/crime-data so both runtimes serve
// identical bytes.
const MixQuery = z.object({
  city: z.string().min(1).max(120).optional(),
  neighborhood: z.string().optional(),
  jurisdiction: z.string().optional(),
  days: z.coerce.number().int().min(1).max(730).optional(),
});

crimeDataRouter.get("/mix", async (req, res, next) => {
  try {
    const q = MixQuery.parse(req.query);
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
    if (q.city) return res.json(await getCitywideCrimeMix(q.city));
    const area = q.neighborhood ?? q.jurisdiction ?? "san-diego";
    return res.json(await getCrimeMix(area, q.days));
  } catch (err) {
    next(err);
  }
});

crimeDataRouter.get("/upticks", async (req, res, next) => {
  try {
    const citySlug = (typeof req.query.city === "string" ? req.query.city : null) ?? "san-diego";
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
    return res.json(await getCitywideUpticks(citySlug));
  } catch (err) {
    next(err);
  }
});
