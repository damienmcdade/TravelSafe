import { aiConfigured, getAIModel } from "./provider";

// AI SDK v6 streamText with whichever provider provider.ts resolves to.
// Default: Google Gemini 2.0 Flash (free tier, 15 RPM / 1,500 RPD). Falls
// back to the Vercel AI Gateway if GOOGLE_GENERATIVE_AI_API_KEY isn't set
// but AI_GATEWAY_API_KEY is.
//
// The route returns a streaming text response. If no AI provider is
// configured, the route short-circuits with a 503 and the composer falls
// back to the local pre-vetter only — never blocks the user.

const SYSTEM_PROMPT = `
You are CommunitySafe's community-post coach.
A user is drafting a neighborhood safety heads-up using three short fields:
"what they observed", "where (a landmark, not an address)", and "when".
Your job is to give brief, calm coaching that helps the post pass CommunitySafe's
moderation rules.

The rules: posts must describe BEHAVIOR and PLACE, not individuals. They cannot
include street addresses, phone numbers, license plates, or names paired with
accusations. They cannot lead with race, ethnicity, religion, or appearance.
They cannot encourage anyone to confront, film, follow, or otherwise approach
a person.

Respond in 2-3 short sentences. Be friendly and constructive. If the draft is
fine, say so plainly. If something is off, name it and suggest a specific
rephrase. Never repeat the user's full draft back.
`.trim();

// v60 — sanitize before splicing into the prompt. The draft fields are
// user-supplied; without stripping newlines + tab/CR a determined user
// could inject "Ignore previous instructions" on its own line. The
// SYSTEM_PROMPT is adversarially framed, but defense-in-depth.
const sanitize = (s: string, max = 800): string =>
  s.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export async function streamComposeFeedback(draft: { what: string; where: string; when: string }) {
  if (!aiConfigured()) {
    return { configured: false as const };
  }
  const model = await getAIModel();
  if (!model) return { configured: false as const };
  const { streamText } = await import("ai");
  const result = await streamText({
    model: model as Parameters<typeof streamText>[0]["model"],
    system: SYSTEM_PROMPT,
    prompt:
      `What: ${sanitize(draft.what, 800)}\n` +
      `Where: ${sanitize(draft.where, 200)}\n` +
      `When: ${sanitize(draft.when, 200)}\n\n` +
      `Coach this draft.`,
  });
  return { configured: true as const, stream: result };
}
