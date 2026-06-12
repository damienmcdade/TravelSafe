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
  const chain = await getAIModelChain();
  return chain[0]?.model ?? null;
}

// v96 — real runtime provider fallback. The coverage probe surfaced
// that operators were configuring BOTH GROQ_API_KEY and
// GOOGLE_GENERATIVE_AI_API_KEY for resilience, but getAIModel() only
// ever returned the first one — when Groq's 100k-tokens-per-day free
// tier exhausted, Gemini sat unused. Now the chain helper resolves
// every configured provider in preference order, and the new
// generateTextWithFallback iterates them at call time, falling
// through to the next on a rate-limit / quota / 5xx error.
export interface AIModelHandle {
  name: "groq" | "gemini" | "gateway";
  model: unknown;
}

export async function getAIModelChain(): Promise<AIModelHandle[]> {
  const out: AIModelHandle[] = [];
  const groq = groqKey();
  if (groq) {
    const { createGroq } = await import("@ai-sdk/groq");
    const provider = createGroq({ apiKey: groq });
    out.push({ name: "groq", model: provider("llama-3.3-70b-versatile") });
  }
  const gemini = geminiKey();
  if (gemini) {
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
    const provider = createGoogleGenerativeAI({ apiKey: gemini });
    out.push({ name: "gemini", model: provider("gemini-2.0-flash") });
  }
  if (env.AI_GATEWAY_API_KEY) {
    // The Vercel AI Gateway accepts a plain `"provider/model"` string
    // where the AI SDK normally expects a LanguageModel object —
    // they're different shapes in the same union, so the cast
    // bridges them at the boundary. `unknown` here (rather than
    // `LanguageModel`) keeps the AIModelHandle.model type honest
    // about what's actually inside.
    out.push({ name: "gateway", model: "anthropic/claude-haiku-4-5" as unknown });
  }
  return out;
}

interface GenOpts {
  system: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
}

interface GenResult {
  text: string;
  provider: AIModelHandle["name"];
}

/// Try each configured provider in order. Catch retryable errors
/// (rate-limit, quota, transient 5xx) and fall through to the next.
/// Non-retryable errors (auth failure, invalid prompt) still propagate.
export async function generateTextWithFallback(opts: GenOpts): Promise<GenResult | null> {
  const chain = await getAIModelChain();
  if (chain.length === 0) return null;
  const { generateText } = await import("ai");
  let lastErr: unknown = null;
  for (const handle of chain) {
    try {
      const res = await generateText({
        // The AI SDK's `model` parameter is a discriminated union of
        // LanguageModel objects (Groq/Gemini handles) and gateway
        // strings (`"provider/model"`). TypeScript can't widen the
        // union narrowly enough here without a generic dance, so we
        // hand the runtime value across the boundary via `any`. The
        // gate above already discriminated by handle.name.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: handle.model as any,
        system: opts.system,
        prompt: opts.prompt,
        temperature: opts.temperature ?? 0.3,
        // fix(audit resilience): bound each tier so a hung provider rejects and
        // the fallback chain actually advances (mirrors the web provider).
        abortSignal: AbortSignal.timeout(20_000),
        ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
      });
      return { text: (res.text ?? "").trim(), provider: handle.name };
    } catch (err) {
      lastErr = err;
      const msg = (err as Error).message ?? "";
      // v113 — ALWAYS fall through to the next configured provider on ANY
      // error. The prior `if (!retryable) break` bailed the whole chain when
      // an error didn't match a narrow rate-limit regex (network blip, model
      // decommissioned, SDK/parse error, content filter), so a single Groq
      // hiccup blanked the brief fleet-wide even with Gemini + gateway
      // configured. Providers are INDEPENDENT — a Groq auth/model failure
      // says nothing about Gemini, so trying the next tier is always correct
      // and cheap. Only give up (null) once every tier has failed.
      // Provider name is kept out of the log (information-symmetric) per the
      // v96 audit note.
      console.warn(`[ai] tier failed, trying next: ${msg.slice(0, 200)}`);
    }
  }
  if (lastErr) {
    console.warn("[ai] all tiers exhausted:", (lastErr as Error).message.slice(0, 200));
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
