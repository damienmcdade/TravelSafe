import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/lib/auth";
import { errorResponse } from "@/server/lib/http";
import { streamComposeFeedback } from "@/server/services/ai/compose-feedback";

const Body = z.object({
  what:  z.string().min(1).max(800),
  where: z.string().min(1).max(200),
  when:  z.string().min(1).max(200),
});

export const dynamic = "force-dynamic";
// v60 — bump from Vercel's 5s default. The endpoint streams LLM output
// (Groq → Gemini → Gateway fallback chain) which can run 5-15s on the
// slow path. Without an explicit maxDuration the function aborts after
// 5s and the client sees a truncated stream while the LLM still bills.
export const maxDuration = 30;
// Auth-gated because each call invokes a paid LLM. requireSession throws
// HttpError(401); we catch via errorResponse since this returns a raw
// streaming Response (not NextResponse) and can't go through wrap().
export async function POST(req: NextRequest) {
  try {
    await requireSession(req);
  } catch (err) {
    return errorResponse(err);
  }
  const draft = Body.parse(await req.json());
  const result = await streamComposeFeedback(draft);
  if (!result.configured) {
    return NextResponse.json({ error: "ai_disabled", message: "No AI provider configured. Set GOOGLE_GENERATIVE_AI_API_KEY (free at aistudio.google.com)." }, { status: 503 });
  }
  if (result.text === null) {
    return NextResponse.json({ error: "ai_unavailable", message: "AI providers are temporarily exhausted; try again in a few minutes." }, { status: 503 });
  }
  // v96 — single-chunk text/plain response (was an SDK-driven stream
  // before the provider fallback rewrite). useTextStream consumes any
  // length of body, so a one-shot chunk keeps the existing client
  // wiring intact.
  return new Response(result.text, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
