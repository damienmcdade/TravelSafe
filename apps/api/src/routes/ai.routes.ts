import { Router } from "express";
import { z } from "zod";
import { writeLimiter, aiReadLimiter } from "../middleware/rate-limit.js";
import { streamComposeFeedback } from "../services/ai/compose-feedback.js";
import { explainIncident } from "../services/ai/incident-explain.service.js";
import { generateAreaBrief } from "../services/ai/area-brief.service.js";
import { generateIncidentSummary } from "../services/ai/incident-summary.service.js";
import { aiConfigured as isAiConfigured } from "../services/ai/provider.js";

export const aiRouter = Router();

const explainBody = z.object({
  description: z.string().min(1).max(400),
});

aiRouter.post("/incident-explain", writeLimiter, async (req, res, next) => {
  try {
    const { description } = explainBody.parse(req.body);
    const out = await explainIncident(description);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

const composeBody = z.object({
  what:  z.string().min(1).max(800),
  where: z.string().min(1).max(200),
  when:  z.string().min(1).max(200),
});

// v38 — area-brief + incident-summary ports from apps/web. Same
// prompt + caching + response shape; Railway-hosted so the Vercel
// proxy can avoid the cold-start LRU reset on every serverless
// instance spin-up.
// v95p42 — route-level timeout. Cold-cache neighborhoods (no prior
// /geo/areas warm) trigger getCrimeMix → full city dataset fetch
// (15-60 pages of upstream data + LLM call), which exceeded our
// audit script's 30s budget and Railway's request timeout. On
// timeout, return null brief so the client renders the "not enough
// data" panel instead of waiting indefinitely. The background
// warm-worker continues populating; subsequent calls are fast.
const AREA_BRIEF_TIMEOUT_MS = 22_000;
const AREA_BRIEF_TIMEOUT = Symbol("area-brief-timeout");
function withAreaBriefTimeout<T>(p: Promise<T>): Promise<T | typeof AREA_BRIEF_TIMEOUT> {
  // fix(audit api-code-6): clear the timer so a fast brief doesn't leave a 22s
  // setTimeout pending.
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<typeof AREA_BRIEF_TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(AREA_BRIEF_TIMEOUT), AREA_BRIEF_TIMEOUT_MS);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

aiRouter.get("/area-brief", aiReadLimiter, async (req, res, next) => {
  try {
    const area = typeof req.query.area === "string" ? req.query.area : "";
    if (!area) return res.status(400).json({ error: "area_required" });
    const out = await withAreaBriefTimeout(generateAreaBrief(area));
    const brief = out === AREA_BRIEF_TIMEOUT ? null : out;
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
    // v66 — was `aiConfigured: brief !== null` which conflated three
    // distinct null cases: (1) provider unset, (2) area has no top
    // offenses, (3) model fetch failed. Cases 2+3 made the frontend
    // hide the entire panel even though AI was working — user-reported
    // as "AI summary inoperable for all neighborhoods" because every
    // sparse-data area returned aiConfigured=false. Now reports the
    // provider state honestly so the panel can render "not enough
    // recent data" instead of disappearing.
    res.json({
      area,
      brief,
      aiConfigured: isAiConfigured(),
      disclaimer:
        "Two-paragraph AI brief grounded in the area's actual top reported " +
        "offenses. Not legal or medical advice; never describes individuals.",
    });
  } catch (err) {
    next(err);
  }
});

const summaryQuery = z.object({
  area: z.string().min(1).max(120).optional(),
  city: z.string().min(1).max(120).optional(),
  windowDays: z.coerce.number().int().min(1).max(180).optional(),
});

// v95p42 — same cold-cache concern as /area-brief; mirror the timeout.
const SUMMARY_TIMEOUT_MS = 22_000;
const SUMMARY_TIMEOUT = Symbol("incident-summary-timeout");

aiRouter.get("/incident-summary", aiReadLimiter, async (req, res, next) => {
  try {
    const q = summaryQuery.parse(req.query);
    if (!q.area && !q.city) {
      return res.status(400).json({ error: "summary_unavailable", reason: "Pass ?area= or ?city=" });
    }
    const p = q.area
      ? generateIncidentSummary({ area: q.area, windowDays: q.windowDays })
      : generateIncidentSummary({ cityOnly: { citySlug: q.city! }, windowDays: q.windowDays });
    // fix(audit api-code-6): clear the timer when the summary wins the race.
    let summaryTimer: ReturnType<typeof setTimeout>;
    const raced = await Promise.race([
      p,
      new Promise<typeof SUMMARY_TIMEOUT>((resolve) => {
        summaryTimer = setTimeout(() => resolve(SUMMARY_TIMEOUT), SUMMARY_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(summaryTimer));
    if (raced === SUMMARY_TIMEOUT) {
      return res.status(503).json({
        error: "upstream_warming",
        message: "Crime feed is still warming for this area. Retry in a moment.",
        retryAfterSeconds: 30,
      });
    }
    if (!raced) {
      return res.status(400).json({ error: "summary_unavailable", reason: "Insufficient data" });
    }
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=900");
    res.json(raced);
  } catch (err) {
    next(err);
  }
});

aiRouter.post("/compose-feedback", writeLimiter, async (req, res, next) => {
  try {
    const draft = composeBody.parse(req.body);
    const result = await streamComposeFeedback(draft);
    if (!result.configured) {
      return res.status(503).json({ error: "ai_disabled", message: "No AI provider configured" });
    }
    if (result.text === null) {
      return res.status(503).json({ error: "ai_unavailable", message: "AI providers temporarily exhausted" });
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    // v96 — single-chunk text/plain; see compose-feedback.ts header
    // comment for why the streamText pipe was retired.
    res.send(result.text);
  } catch (err) {
    next(err);
  }
});
