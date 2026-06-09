import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { tryProxy } from "@/server/lib/proxy-to-api";
import { generateAreaBrief } from "@/server/services/ai/area-brief";
import { aiConfigured } from "@/server/services/ai/provider";

const Query = z.object({
  area: z.string().min(1).max(80),
});

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// fix(ai-summary-cross-client): was requireSession-gated, which 401'd for
// EVERY session-less client — the native WKWebView (cross-origin, no
// same-origin cs_session cookie), Safari ITP / third-party-cookie blocking,
// privacy modes, and the first-paint bootstrap race. The /watch AI Summary
// panel (AreaBriefPanel) then showed "Could not generate a brief" on every
// city for those users. The endpoint is now PUBLIC — identical to its twin
// /api/ai/incident-summary (always public) — and still fully protected:
//   • Vercel middleware caps /api/ai/* at 40/min per IP,
//   • Railway's /ai/area-brief applies aiReadLimiter,
//   • the brief is cached 30 min per area (LLM runs ≤2×/area/hour).
// No auth means no per-user LLM cost surprise; the IP cap + cache bound spend.
export const GET = wrap(async (req: NextRequest) => {
  // v38: prefer Railway when API_BASE_URL is set so the brief cache
  // survives Vercel cold starts (Redis-backed on Railway). Local
  // fallback on any upstream error.
  const proxied = await tryProxy(req, "/ai/area-brief");
  if (proxied) return proxied.response;

  const { area } = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const brief = await generateAreaBrief(area);
  // v66 — was `aiConfigured: brief !== null`, which falsely reported
  // AI-unconfigured for every sparse-data area and made the panel
  // disappear entirely. Now reflects the actual provider state so the
  // panel renders its "not enough recent data" fallback instead.
  return NextResponse.json({
    area,
    brief,
    aiConfigured: aiConfigured(),
    disclaimer:
      "AI-generated summary grounded in the most-reported offenses for this area. " +
      "Not legal or medical advice. Treat as a starting point for awareness, not a verdict.",
  });
});
