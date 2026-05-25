import { Router } from "express";
import { z } from "zod";
import {
  getSafetyScore,
  getCitywideSafetyScore,
} from "@travelsafe/crime-data/safety-score";
import {
  getTrendForArea,
  getCitywideTrend,
} from "@travelsafe/crime-data/trend-feed";
import { getRedis } from "../lib/redis.js";

export const safezoneRouter = Router();

// /safezone/safety-score?city=<slug> OR ?area=<slug>&label=<label>.
// Mirrors the Vercel-side /api/safezone/safety-score handler in
// apps/web. Both Vercel and Railway can serve the same response now
// that the underlying scoring code lives in @travelsafe/crime-data.
const ScoreQuery = z.object({
  city:  z.string().min(1).max(120).optional(),
  area:  z.string().min(1).max(120).optional(),
  label: z.string().min(1).max(120).optional(),
}).refine((q) => Boolean(q.city) !== Boolean(q.area), {
  message: "Pass exactly one of `city` or `area`.",
});

// v68 hotfix — bound the per-request work to 25s so the route never
// hangs indefinitely on cold-cache adapters. Cleveland's adapter
// in particular takes ~5min cold (bounded-concurrency CFS
// pagination), which left every Cleveland safety-score request
// blocking until either the adapter finished or the client gave up.
// On timeout we return 503 with a "warming up" hint so the client
// can show a friendly retry-in-a-moment surface instead of a
// generic timeout error. The warm-worker continues populating the
// cache in the background.
const SCORE_TIMEOUT_MS = 25_000;
function withScoreTimeout<T>(p: Promise<T>): Promise<T | typeof TIMEOUT> {
  return Promise.race([
    p,
    new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), SCORE_TIMEOUT_MS)),
  ]);
}
const TIMEOUT = Symbol("safety-score-timeout");

safezoneRouter.get("/safety-score", async (req, res, next) => {
  try {
    const { city, area, label } = ScoreQuery.parse(req.query);
    // Cache-Control mirrors the Vercel edge cache so a CDN in front
    // of Railway (Cloudflare etc.) can reuse the same posture.
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=900");

    // v69 — Redis L2 fast path for citywide requests. The warm-worker
    // persists getCitywideSafetyScore results to Redis on every cycle
    // (30min TTL); reading from Redis here is ~5-10ms vs the 50-200ms
    // in-process aggregation, AND survives container restart (the
    // previously-painful Cleveland cold start now lands in a few ms
    // if the prior container's warm-cycle ran before the deploy).
    // Per-area /safety-score?area= still falls through to compute
    // because there are too many area variants to cache eagerly.
    if (city) {
      const redis = getRedis();
      if (redis) {
        try {
          const cached = await redis.get(`citywide:${city}`);
          if (cached) {
            // v70 — sanity-check the cached payload before serving it.
            // A v69 bug allowed degenerate scores (windowDays=0,
            // all-zero counts) into Redis from transient warm-worker
            // failures; the old route returned them blindly and
            // users saw grade=N/A for 30min until TTL expired.
            // Reject + fall through whenever the cached value looks
            // broken so the in-process compute path recovers
            // immediately. The next warm cycle's healthy result
            // overwrites the bad entry.
            const parsed = JSON.parse(cached) as { windowDays?: number; rows?: Array<{ count?: number }> };
            const totalCounted = (parsed.rows ?? []).reduce((s, r) => s + (r.count ?? 0), 0);
            if ((parsed.windowDays ?? 0) > 0 && totalCounted > 0) {
              return res.json(parsed);
            }
          }
        } catch {
          // Redis fail-soft — fall through to compute below
        }
      }
    }

    const result = city
      ? await withScoreTimeout(getCitywideSafetyScore(city))
      : await withScoreTimeout(getSafetyScore(area!, label ?? area!));
    if (result === TIMEOUT) {
      return res.status(503).json({
        error: "warming_up",
        message: "This city's data is still loading. Try again in a moment — typically resolves within 30s.",
      });
    }
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

const TrendQuery = z.object({
  city:  z.string().min(1).max(120).optional(),
  area:  z.string().min(1).max(120).optional(),
  label: z.string().min(1).max(120).optional(),
  days:  z.coerce.number().int().min(1).max(180).optional(),
}).refine((q) => Boolean(q.city) !== Boolean(q.area), {
  message: "Pass exactly one of `city` or `area`.",
});

safezoneRouter.get("/trend", async (req, res, next) => {
  try {
    const { city, area, label, days } = TrendQuery.parse(req.query);
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
    if (city) return res.json(await getCitywideTrend(city, { windowDays: days }));
    return res.json(await getTrendForArea(area!, label ?? area!, { windowDays: days }));
  } catch (err) {
    next(err);
  }
});
