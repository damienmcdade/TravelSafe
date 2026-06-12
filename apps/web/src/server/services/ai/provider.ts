import "server-only";
import { env } from "../../lib/env";

// Single source of truth for which AI model CommunitySafe uses.
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

/// Returns the LanguageModel handle CommunitySafe should pass to streamText /
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
  const chain = await getAIModelChain();
  return chain[0]?.model ?? null;
}

// v96 — real runtime provider fallback. Operators were configuring
// both GROQ_API_KEY and GOOGLE_GENERATIVE_AI_API_KEY for resilience,
// but getAIModel() only ever returned the first one. When Groq's
// 100k-tokens-per-day free tier exhausted, every AI surface returned
// null instead of falling through to Gemini. The chain helper resolves
// every configured provider in preference order, and the new
// generateTextWithFallback iterates them at call time on retryable
// (rate-limit / quota / transient 5xx) errors.
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
  const key = geminiKey();
  if (key) {
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
    const provider = createGoogleGenerativeAI({ apiKey: key });
    out.push({ name: "gemini", model: provider("gemini-2.0-flash") });
  }
  if (env.AI_GATEWAY_API_KEY) {
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

export async function generateTextWithFallback(opts: GenOpts): Promise<GenResult | null> {
  const chain = await getAIModelChain();
  if (chain.length === 0) return null;
  const { generateText } = await import("ai");
  let lastErr: unknown = null;
  for (const handle of chain) {
    try {
      const res = await generateText({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: handle.model as any,
        system: opts.system,
        prompt: opts.prompt,
        temperature: opts.temperature ?? 0.3,
        // fix(audit resilience): bound each tier. Without abortSignal a provider
        // that HANGS the stream never throws, so the Groq→Gemini→gateway
        // fallback never advances — the multi-provider design silently does
        // nothing and the request stalls to the platform function ceiling. A
        // hang now rejects at 20s and falls through to the next tier.
        abortSignal: AbortSignal.timeout(20_000),
        ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
      });
      return { text: (res.text ?? "").trim(), provider: handle.name };
    } catch (err) {
      lastErr = err;
      const msg = (err as Error).message ?? "";
      // v113 — ALWAYS fall through to the next configured provider on ANY
      // error (mirrors apps/api/src/services/ai/provider.ts). The prior
      // narrow-regex `break` bailed the whole chain on any non-rate-limit
      // error (network blip, model decommissioned, SDK/content error),
      // blanking the brief even with Gemini + gateway configured. Providers
      // are independent, so trying the next tier is always correct. Provider
      // name kept out of the log (information-symmetric) per the v96 audit.
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

// v62 — log the resolved provider chain ONCE at module load so a
// silent prod misconfig (e.g. GROQ_API_KEY accidentally unset, falls
// through to Gemini's lower free-tier RPM and silently degrades UX)
// is visible in Vercel logs without needing the AI audit diag endpoint.
// In dev (NODE_ENV !== "production") we stay quiet so test runs don't
// spam stdout.
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
