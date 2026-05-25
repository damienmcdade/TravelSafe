import { env } from "../../env.js";

// Mirror of apps/web/src/server/services/ai/provider.ts so Railway-side
// services pick the same free-tier provider the Vercel side already
// uses. Preference: Groq → Gemini → Vercel AI Gateway. Returns the
// LanguageModel handle to hand to streamText/generateText, or null if
// no provider is configured.

function groqKey(): string | undefined {
  return env.GROQ_API_KEY || env.GROQAPI;
}

function geminiKey(): string | undefined {
  return env.GOOGLE_GENERATIVE_AI_API_KEY || env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
}

export async function getAIModel(): Promise<unknown | null> {
  const groq = groqKey();
  if (groq) {
    const { createGroq } = await import("@ai-sdk/groq");
    const provider = createGroq({ apiKey: groq });
    return provider("llama-3.3-70b-versatile");
  }
  const gemini = geminiKey();
  if (gemini) {
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
    const provider = createGoogleGenerativeAI({ apiKey: gemini });
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

// v62 — startup visibility on the resolved provider chain. Mirror of
// the apps/web provider. See that file's comment for the rationale.
if (process.env.NODE_ENV === "production") {
  const chain: string[] = [];
  if (groqKey()) chain.push("groq");
  if (geminiKey()) chain.push("gemini");
  if (env.AI_GATEWAY_API_KEY) chain.push("gateway");
  if (chain.length === 0) {
    console.warn("[ai] no provider configured — set GROQ_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or AI_GATEWAY_API_KEY. AI features will return null fallbacks.");
  } else {
    console.log(`[ai] provider chain: ${chain.join(" → ")}`);
  }
}
