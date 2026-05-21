import { Router } from "express";
import { z } from "zod";
import { writeLimiter } from "../middleware/rate-limit.js";
import { streamComposeFeedback } from "../services/ai/compose-feedback.js";

export const aiRouter = Router();

const composeBody = z.object({
  what:  z.string().min(1).max(800),
  where: z.string().min(1).max(200),
  when:  z.string().min(1).max(200),
});

aiRouter.post("/compose-feedback", writeLimiter, async (req, res, next) => {
  try {
    const draft = composeBody.parse(req.body);
    const result = await streamComposeFeedback(draft);
    if (!result.configured) {
      return res.status(503).json({ error: "ai_disabled", message: "AI_GATEWAY_API_KEY not configured" });
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    // ai SDK v6 streamText returns an object with `textStream` (AsyncIterable<string>).
    for await (const chunk of result.stream.textStream) {
      res.write(chunk);
    }
    res.end();
  } catch (err) {
    next(err);
  }
});
