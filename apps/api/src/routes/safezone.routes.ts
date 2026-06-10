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
import { humanizeArea } from "@travelsafe/crime-data/cities";
import { getRedis } from "../lib/redis.js";

// A label equal to the slug means the caller didn't supply a real display
// name (the frontend warm-prefetch + direct API hits both do this). Derive a
// human label so cards + headlines read "Azalea Trails", not "gnv-azalea-trails".
const displayLabel = (area: string, label?: string): string =>
  label && label !== area ? label : humanizeArea(area);

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

// v68 — bound the per-request work to a deadline so the route never
// hangs indefinitely on cold-cache adapters. Cleveland's adapter
// in particular takes ~30s cold (bounded-concurrency CFS
// pagination over 30 pages), and other heavy cities can take 15-25s
// on first-touch. On timeout we return 503 with a "warming up" hint
// so the client can show a friendly retry-in-a-moment surface
// instead of a generic timeout error. The warm-worker continues
// populating the cache in the background.
// v71 followup — bumped 25s → 45s. The pre-rollout audit caught the
// 25s ceiling cutting off Cleveland's first request on every fresh
// container before the warm-worker could populate Redis. 45s still
// fits inside Vercel's 60s tryProxy header timeout with 15s headroom.
const SCORE_TIMEOUT_MS = 45_000;
function withScoreTimeout<T>(p: Promise<T>): Promise<T | typeof TIMEOUT> {
  // fix(audit perf-score-timer-leak): clear the deadline timer when the compose
  // wins (the common warm-cache path, ~180ms) so a 45s timer + closure isn't
  // retained on every non-cached safety-score request.
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), SCORE_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
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
            const parsed = JSON.parse(cached) as { windowDays?: number; dataConfidence?: string; rows?: Array<{ count?: number }> };
            const totalCounted = (parsed.rows ?? []).reduce((s, r) => s + (r.count ?? 0), 0);
            // fix(audit cold-score-latch): only serve a cached citywide score
            // when it's HIGH confidence. A PROVISIONAL (low/medium) score is the
            // cold-tier partial that improves once the adapter warms — serving it
            // from the 30-min Redis cache would latch the wrong grade until TTL.
            // Falling through recomputes against the now-warm cache; the next warm
            // cycle writes the HIGH result. (Citywide is HIGH in steady state for
            // all 45 jurisdictions, so this only bypasses the cold transient.)
            const cacheable = city ? parsed.dataConfidence === "high" : true;
            if ((parsed.windowDays ?? 0) > 0 && totalCounted > 0 && cacheable) {
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
      : await withScoreTimeout(getSafetyScore(area!, displayLabel(area!, label)));
    if (result === TIMEOUT) {
      return res.status(503).json({
        error: "warming_up",
        message: "This city's data is still loading. Try again in a moment — typically resolves within 30s.",
      });
    }
    return res.json(result);
  } catch (err) {
    // v96 — convert the explicit "city_not_supported" thrown by
    // getCitywideSafetyScore into a clean 404 instead of leaking it
    // through to the 500 handler. The prior silent fallback to
    // San Diego made this masquerade as a 200, which produced the
    // identical-payloads-across-different-cities data bleed.
    if (err instanceof Error && err.message.startsWith("city_not_supported:")) {
      return res.status(404).json({
        error: "city_not_supported",
        message: `No adapter configured for city "${err.message.slice("city_not_supported:".length).trim()}". Pass a known city slug.`,
      });
    }
    // v104 — an unknown ?area= slug threw out of getSafetyScore and surfaced as
    // a 500; return a clean 404 instead (the audit caught this — bogus area
    // slugs are client error, not server error).
    if (err instanceof Error && err.message.startsWith("Unknown area slug")) {
      return res.status(404).json({ error: "area_not_found", message: err.message });
    }
    next(err);
  }
});

const TrendQuery = z.object({
  city:  z.string().min(1).max(120).optional(),
  area:  z.string().min(1).max(120).optional(),
  label: z.string().min(1).max(120).optional(),
  days:  z.coerce.number().int().min(1).max(180).optional(),
  // v99 — bullets caps the dispatch list; bullets=0 skips the ~760 KB
  // payload for callers that only need freshness/summary.
  bullets: z.coerce.number().int().min(0).max(5000).optional(),
}).refine((q) => Boolean(q.city) !== Boolean(q.area), {
  message: "Pass exactly one of `city` or `area`.",
});

safezoneRouter.get("/trend", async (req, res, next) => {
  try {
    const { city, area, label, days, bullets } = TrendQuery.parse(req.query);
    // fix(audit perf-compute-4): omitted bullets defaults to a cap (500), not the
    // full ~760 KB list — parity with the Vercel /api/safezone/trend route.
    const bulletLimit = bullets ?? 500;
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
    if (city) return res.json(await getCitywideTrend(city, { windowDays: days, bulletLimit }));
    return res.json(await getTrendForArea(area!, displayLabel(area!, label), { windowDays: days, bulletLimit }));
  } catch (err) {
    next(err);
  }
});
