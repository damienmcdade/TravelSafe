import { Router } from "express";
import { z } from "zod";
import { optionalAuth } from "../middleware/auth.js";
// v62 — switched from the SD-only legacy adapter to the workspace
// dispatcher so /crime-data/{citywide,area-stats,recent,alerts,
// insights} respects the ?city= param. Prior implementation
// hardcoded SD_AREAS and ignored every per-city query, which made
// Vercel proxies return SD data for every other city.
import { crimeData } from "@travelsafe/crime-data/dispatcher";
import { breadcrumb } from "../lib/sentry.js";
import { nearestArea } from "../services/crime-data/neighborhoods.js";
import { getCrimeMix, getCitywideCrimeMix } from "@travelsafe/crime-data/mix";
import { getCitywideUpticks } from "@travelsafe/crime-data/upticks";

export const crimeDataRouter = Router();

// v62 sync — Vercel routes accept `city` as a first-class param;
// Express side was missing it across most handlers, which meant
// `?city=detroit` proxied from Vercel was effectively dropped on
// Railway and the wrong (default SD) city's data came back. Add
// `city` to the shared shape so all proxied routes honor it.
const areaQuery = z.object({
  city: z.string().min(1).max(120).optional(),
  neighborhood: z.string().optional(),
  jurisdiction: z.string().optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  windowDays: z.coerce.number().int().min(1).max(730).optional(),
  offense: z.string().max(120).optional(),
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

// v95p39 — timeout + graceful 503 instead of hanging the client when
// the upstream city ArcGIS is slow. Mirrors the pattern safezone.routes
// uses for /safety-score. The sync-drift CI was flagging Detroit
// because both Vercel and Railway hung on this endpoint (both wait on
// the same upstream); returning a clean 503 lets the client show a
// retry-in-a-moment surface and lets CI distinguish "upstream slow"
// from "drift between our two runtimes".
const CITYWIDE_TIMEOUT_MS = 45_000;
const CITYWIDE_TIMEOUT = Symbol("citywide-timeout");
function withCitywideTimeout<T>(p: Promise<T>): Promise<T | typeof CITYWIDE_TIMEOUT> {
  // fix(audit api-code-6): clear the timer when the real work wins the race —
  // otherwise the 45s setTimeout lingers (keeping the event loop / a closure
  // alive) on every fast request, which adds up under load on the memory-bounded
  // Railway container.
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<typeof CITYWIDE_TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(CITYWIDE_TIMEOUT), CITYWIDE_TIMEOUT_MS);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

crimeDataRouter.get("/citywide", optionalAuth, async (req, res, next) => {
  try {
    const q = areaQuery.parse(req.query);
    const city = q.city ?? "san-diego";
    breadcrumb("crime-data", "citywide", { city, offense: q.offense, windowDays: q.windowDays });
    const result = await withCitywideTimeout(
      crimeData.getCitywide(city, { offense: q.offense, windowDays: q.windowDays }),
    );
    if (result === CITYWIDE_TIMEOUT) {
      return res.status(503).json({
        error: "upstream_timeout",
        message:
          `${city}'s public crime feed is slow right now. The page will retry — ` +
          "this typically clears once the warm cycle finishes.",
        retryAfterSeconds: 60,
      });
    }
    // v99 — this endpoint was the one crime-data GET with NO Cache-Control,
    // so the CDN/edge hit origin on every load (~0.8s each, even warm).
    // Match the trend/mix/upticks routes so repeat loads are absorbed.
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
    res.json(result);
  } catch (err) {
    // v96 — same city_not_supported handling as the safety-score route.
    if (err instanceof Error && err.message.startsWith("city_not_supported:")) {
      return res.status(404).json({
        error: "city_not_supported",
        message: `No adapter configured for city "${err.message.slice("city_not_supported:".length).trim()}". Pass a known city slug.`,
      });
    }
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
    // v62 sync — Vercel route accepts ?city= for citywide totals.
    if (q.city) return res.json(await crimeData.getCitywideAreaStats(q.city));
    const area = resolveArea(q);
    if (!area) return res.status(400).json({ error: "area_or_city_required" });
    // v96p2 — pen-test follow-up: was returning `200 null` for any
    // ?neighborhood= that resolved to a string but couldn't be
    // matched by the adapter. Inconsistent with /insights (which
    // 404s in the same case) and made it hard for callers to
    // distinguish "valid area, no data" from "garbage input". Now
    // 404 on unresolvable so the client surface is consistent.
    const stats = await crimeData.getAreaStats(area);
    if (stats == null) return res.status(404).json({ error: "unknown_area" });
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

crimeDataRouter.get("/insights", optionalAuth, async (req, res, next) => {
  try {
    const q = areaQuery.parse(req.query);
    // v62 sync — Vercel route accepts ?city= for citywide 12-week trend.
    if (q.city) {
      const { getCitywideInsights } = await import("../services/crime-data/insights.service.js");
      return res.json(await getCitywideInsights(q.city));
    }
    const area = resolveArea(q);
    if (!area) return res.status(400).json({ error: "area_or_city_required" });
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
    if (err instanceof Error && err.message.startsWith("city_not_supported:")) {
      return res.status(404).json({ error: "city_not_supported", message: err.message.slice("city_not_supported:".length).trim() });
    }
    next(err);
  }
});

crimeDataRouter.get("/upticks", async (req, res, next) => {
  try {
    const citySlug = (typeof req.query.city === "string" ? req.query.city : null) ?? "san-diego";
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
    return res.json(await getCitywideUpticks(citySlug));
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("city_not_supported:")) {
      return res.status(404).json({ error: "city_not_supported", message: err.message.slice("city_not_supported:".length).trim() });
    }
    next(err);
  }
});
