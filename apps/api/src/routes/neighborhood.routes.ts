import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { PostStatus, AreaKind } from "@prisma/client";
import { optionalAuth } from "../middleware/auth.js";
// v62 — workspace dispatcher (multi-city) instead of the SD-only
// legacy adapter, so per-neighborhood feed works for every city.
import { crimeData } from "@travelsafe/crime-data/dispatcher";

export const neighborhoodRouter = Router();

neighborhoodRouter.get("/", optionalAuth, async (_req, res, next) => {
  try {
    const areas = await prisma.area.findMany({
      where: { kind: AreaKind.NEIGHBORHOOD },
      orderBy: { name: "asc" },
    });
    res.json(areas);
  } catch (err) {
    next(err);
  }
});

neighborhoodRouter.get("/feed", optionalAuth, async (req, res, next) => {
  try {
    const q = z.object({ neighborhood: z.string() }).parse(req.query);
    const area = await prisma.area.findUnique({ where: { slug: q.neighborhood } });
    if (!area) return res.status(404).json({ error: "unknown_neighborhood" });

    const [posts, alerts, recent] = await Promise.all([
      prisma.post.findMany({
        where: { areaId: area.id, status: PostStatus.VERIFIED },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { author: { select: { id: true, displayName: true } }, _count: { select: { comments: true, reactions: true } } },
      }),
      crimeData.getAreaAlerts(q.neighborhood),
      crimeData.getRecentReports(q.neighborhood, { limit: 10 }),
    ]);

    res.json({ area, posts, alerts, recent });
  } catch (err) {
    next(err);
  }
});
