import "server-only";
import { env } from "../../lib/env";

// Single source of truth for which AI model TravelSafe uses.
//
// Preferred: Google Gemini 2.0 Flash via @ai-sdk/google. Free tier: 15 RPM /
// 1,500 requests/day per Google Cloud project — enough headroom for the
// assistant + per-neighborhood safety tip generator + community-post coach
// at production traffic. Get a key from https://aistudio.google.com/app/apikey
// and set GOOGLE_GENERATIVE_AI_API_KEY in Vercel.
//
// Fallback: Vercel AI Gateway with "anthropic/claude-haiku-4-5" if
// GOOGLE_GENERATIVE_AI_API_KEY isn't set but AI_GATEWAY_API_KEY is. This keeps
// existing paid setups working without a code change.

/// Returns the LanguageModel handle TravelSafe should pass to streamText /
/// generateText, or null if no AI provider is configured. Callers must guard
/// for null and degrade gracefully (assistant returns 503; tip generator
/// returns []).
export async function getAIModel(): Promise<unknown | null> {
  if (env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const { google } = await import("@ai-sdk/google");
    // gemini-2.0-flash: 1M-token context, supports streaming + tool calling,
    // ~sub-second TTFB for most queries.
    return google("gemini-2.0-flash");
  }
  if (env.AI_GATEWAY_API_KEY) {
    // Legacy: rely on the Vercel AI Gateway routing the string identifier.
    return "anthropic/claude-haiku-4-5" as unknown;
  }
  return null;
}

export function aiConfigured(): boolean {
  return Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY || env.AI_GATEWAY_API_KEY);
}
