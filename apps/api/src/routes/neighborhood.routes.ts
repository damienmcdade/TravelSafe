import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { PostStatus, AreaKind } from "../generated/prisma/client.js";
import { optionalAuth } from "../middleware/auth.js";
// v62 — workspace dispatcher (multi-city) instead of the SD-only
// legacy adapter, so per-neighborhood feed works for every city.
import { crimeData } from "@travelsafe/crime-data/dispatcher";

export const neighborhoodRouter = Router();

// v96 — audit flagged this as an unbounded findMany. At the 30-city
// target rollout the Area.NEIGHBORHOOD slice approaches ~5k rows and
// the list call previously shipped the entire set on every hit. Cap
// at 1000 (covers every single-city slice; LA tops out around 270).
// Response shape kept as a bare array so we don't break unknown
// clients — pagination can be added behind ?cursor= later if a
// caller genuinely needs the tail.
const NEIGHBORHOOD_LIST_CAP = 1000;
neighborhoodRouter.get("/", optionalAuth, async (_req, res, next) => {
  try {
    const areas = await prisma.area.findMany({
      where: { kind: AreaKind.NEIGHBORHOOD },
      orderBy: { name: "asc" },
      take: NEIGHBORHOOD_LIST_CAP,
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
