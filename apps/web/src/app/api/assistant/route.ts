import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError } from "zod";
import { streamAssistant } from "@/server/services/ai/assistant";

const Body = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(4000),
  })).min(1).max(40),
});

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Streaming endpoint — wraps its own error handling because the route returns
// the AI SDK's text-stream Response (not NextResponse), so it can't go through
// the shared `wrap` helper.
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { messages } = Body.parse(await req.json());
    const r = await streamAssistant(messages);
    if (!r.configured) {
      return NextResponse.json(
        { error: "assistant_not_configured", note: "No AI provider configured. Set GOOGLE_GENERATIVE_AI_API_KEY (free at aistudio.google.com) or AI_GATEWAY_API_KEY on this deployment." },
        { status: 503 },
      );
    }
    return r.stream.toTextStreamResponse({
      headers: { "Cache-Control": "no-cache, no-transform" },
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "validation_failed", issues: err.issues }, { status: 400 });
    }
    console.error("[assistant]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
