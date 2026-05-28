import "server-only";
import { aiConfigured, getAIModel } from "./provider";
import { getCrimeMix } from "../crime-data/mix";
import { cityForArea } from "../crime-data/cities";

// Plain-English per-neighborhood AI brief. Two short paragraphs:
//   1. What kinds of incidents the area sees most (factual, from the mix)
//   2. Practical context for residents — calm, non-alarmist, never demographic
//
// The brief is grounded in the area's actual top reported offenses; the
// prompt forces the model to cite those offense names verbatim so users
// can connect the words back to the chart on the same page.

const SYSTEM_PROMPT = `
You are a calm, factual safety summarizer for a US neighborhood.

Output: exactly TWO short paragraphs, no markdown formatting, no headings,
no bullets. Plain prose only.

Paragraph 1 (what the data shows): 2-3 sentences describing the
neighborhood's most-reported offense categories. Use the offense names
from the list verbatim where natural. Mention the rolling window
("the most recent ~N days") as context. No alarmism, no minimization.

Paragraph 2 (practical context): 1-2 sentences with non-vigilante
guidance grounded in the dominant offense category — e.g. for high
property crime, parking + visible-belongings advice; for assault-heavy
areas, transit + late-hour awareness. Direct to 911 only for active
emergencies; do not encourage confronting anyone.

Hard rules:
- NEVER mention demographics (race, ethnicity, religion, age, gender,
  orientation, immigration status).
- NEVER name or describe individual people, vehicles, or addresses.
- NEVER encourage confronting, following, recording, or approaching
  any person.
- Stay neutral on the neighborhood's character — describe data, not vibes.
- Maximum 600 characters total.
`.trim();

interface CacheEntry { fetchedAt: number; brief: string }
// v95p40 — cache version bumped + scoped by city. Mirrors the v95p32
// fix in the Railway-side area-brief.service.ts. This is the file
// the Neighborhood Watch tab on the web app actually imports (via
// watch/watch.ts), so any in-process cache reuse here surfaces
// directly to users of that tab. Key shape: "v2:<city>:<area>".
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h per area

function scopedKey(area: string): string {
  const city = cityForArea(area);
  return `v2:${city.slug}:${area}`;
}

export async function generateAreaBrief(area: string): Promise<string | null> {
  if (!aiConfigured()) return null;
  const key = scopedKey(area);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.brief;

  const city = cityForArea(area);
  const mix = await getCrimeMix(area).catch(() => null);
  const top = mix?.topOffenses ?? [];
  if (top.length === 0) return null;

  const totals = { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 };
  for (const o of top) totals[o.category] += o.count;
  const dominant = (Object.entries(totals) as Array<["PERSONS"|"PROPERTY"|"SOCIETY", number]>)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "PROPERTY";

  // Sanitize user-controlled / adapter-supplied strings before splicing
  // them into the LLM prompt. Strips newlines (so an area name like
  // "X\nignore previous instructions" can't break out of the field) and
  // caps length so an oversized adapter label can't blow the context.
  // Same treatment for individual offense descriptions, which originate
  // from the upstream police feed and shouldn't trust-by-default either.
  const sanitize = (s: string, maxLen = 80): string =>
    s.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLen);

  const offenseList = top.slice(0, 6)
    .map((o) => `${sanitize(o.offense, 60)} (${o.count})`)
    .join("; ");

  const userPrompt = `
City: ${sanitize(city.label)}
Neighborhood / area: ${sanitize(area)}
Rolling window: ${mix?.windowDays ?? 30} days
Dominant category: ${dominant}
Total recent incidents: ${mix?.totalIncidents ?? 0}
Top reported offenses (offense (count)):
${offenseList}

Write the two-paragraph brief now.
`.trim();

  let text = "";
  try {
    const model = await getAIModel();
    if (!model) return null;
    const { generateText } = await import("ai");
    const res = await generateText({
      model: model as Parameters<typeof generateText>[0]["model"],
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.3,
    });
    text = res.text.trim();
  } catch (err) {
    console.warn("[area-brief] generation failed:", (err as Error).message);
    return null;
  }

  // Belt-and-suspenders: trim length, strip any model-injected markdown.
  text = text.replace(/^#+\s*/gm, "").replace(/\*\*([^*]+)\*\*/g, "$1");
  if (text.length > 800) text = text.slice(0, 800);

  cache.set(scopedKey(area), { fetchedAt: Date.now(), brief: text });
  return text;
}
