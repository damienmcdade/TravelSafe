import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { streamComposeFeedback } from "@/server/services/ai/compose-feedback";

const Body = z.object({
  what:  z.string().min(1).max(800),
  where: z.string().min(1).max(200),
  when:  z.string().min(1).max(200),
});

export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const draft = Body.parse(await req.json());
  const result = await streamComposeFeedback(draft);
  if (!result.configured) {
    return NextResponse.json({ error: "ai_disabled", message: "No AI provider configured. Set GOOGLE_GENERATIVE_AI_API_KEY (free at aistudio.google.com)." }, { status: 503 });
  }
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of result.stream.textStream) {
          controller.enqueue(enc.encode(chunk));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
