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

function geminiKey(): string | undefined {
  return env.GOOGLE_GENERATIVE_AI_API_KEY || env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
}

/// Returns the LanguageModel handle TravelSafe should pass to streamText /
/// generateText, or null if no AI provider is configured. Callers must guard
/// for null and degrade gracefully (assistant returns 503; tip generator
/// returns []).
export async function getAIModel(): Promise<unknown | null> {
  const key = geminiKey();
  if (key) {
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
    // Pass the key explicitly — covers cases where the user named the env var
    // GEMINI_API_KEY or GOOGLE_API_KEY instead of the SDK default.
    const provider = createGoogleGenerativeAI({ apiKey: key });
    // gemini-2.0-flash: 1M-token context, supports streaming + tool calling,
    // ~sub-second TTFB for most queries.
    return provider("gemini-2.0-flash");
  }
  if (env.AI_GATEWAY_API_KEY) {
    return "anthropic/claude-haiku-4-5" as unknown;
  }
  return null;
}

export function aiConfigured(): boolean {
  return Boolean(geminiKey() || env.AI_GATEWAY_API_KEY);
}
