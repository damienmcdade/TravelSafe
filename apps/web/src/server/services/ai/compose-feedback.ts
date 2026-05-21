import { env } from "../../lib/env";

// Vercel AI Gateway via the AI SDK v6. Uses the plain "provider/model" string
// convention so the gateway can route + fail over between providers.
//
// The route returns a streaming text response. If AI_GATEWAY_API_KEY isn't
// configured, the route short-circuits with a 503 and the composer falls
// back to the local pre-vetter only — never blocks the user.

const SYSTEM_PROMPT = `
You are TravelSafe's community-post coach.
A user is drafting a neighborhood safety heads-up using three short fields:
"what they observed", "where (a landmark, not an address)", and "when".
Your job is to give brief, calm coaching that helps the post pass TravelSafe's
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

export async function streamComposeFeedback(draft: { what: string; where: string; when: string }) {
  if (!env.AI_GATEWAY_API_KEY) {
    return { configured: false as const };
  }
  const { streamText } = await import("ai");
  const result = await streamText({
    // Vercel AI Gateway routes "anthropic/claude-haiku-4-5" without provider-specific imports.
    model: "anthropic/claude-haiku-4-5",
    system: SYSTEM_PROMPT,
    prompt:
      `What: ${draft.what}\n` +
      `Where: ${draft.where}\n` +
      `When: ${draft.when}\n\n` +
      `Coach this draft.`,
  });
  return { configured: true as const, stream: result };
}
