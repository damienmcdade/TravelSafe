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
///
/// Provider preference order:
///  1. Groq — free, fast, broad quota (30 RPM / 14,400 RPD)
///  2. Google Gemini — free tier (15 RPM / 1,500 RPD per project) but the
///     AI-Studio "Create key" flow sometimes mints keys against projects
///     with zero quota; we try it second to avoid surprise 429s.
///  3. Vercel AI Gateway — legacy paid fallback.
function groqKey(): string | undefined {
  return env.GROQ_API_KEY || env.GROQAPI;
}

export async function getAIModel(): Promise<unknown | null> {
  const groq = groqKey();
  if (groq) {
    const { createGroq } = await import("@ai-sdk/groq");
    const provider = createGroq({ apiKey: groq });
    // Llama 3.3 70B Versatile — current free flagship on Groq, supports tool
    // calling + structured JSON output (all the prompts we use).
    return provider("llama-3.3-70b-versatile");
  }
  const key = geminiKey();
  if (key) {
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
    const provider = createGoogleGenerativeAI({ apiKey: key });
    return provider("gemini-2.0-flash");
  }
  if (env.AI_GATEWAY_API_KEY) {
    return "anthropic/claude-haiku-4-5" as unknown;
  }
  return null;
}

export function aiConfigured(): boolean {
  return Boolean(groqKey() || geminiKey() || env.AI_GATEWAY_API_KEY);
}
