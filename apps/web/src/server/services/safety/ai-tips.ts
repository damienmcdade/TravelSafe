import "server-only";
import { z } from "zod";
import { aiConfigured, getAIModel } from "../ai/provider";
import { getCrimeMix } from "../crime-data/mix";
import { cityForArea } from "../crime-data/cities";

// Per-neighborhood safety tip generator.
//
// The original tips system pulled from a hand-curated array of ~10 tips
// scored against the area's top offenses. With only ~10 entries every
// neighborhood landed on the same prevention bucket — users reported the
// app was generating identical guidance for very different places.
//
// New behavior: call Claude Haiku via the Vercel AI Gateway with the
// neighborhood's actual top reported offenses and ask for exactly 10
// distinct, source-attributed tips. The prompt forces specificity
// (each tip must address an actual top offense or category) and forbids
// vigilante / demographic / personal-identification language. Results
// are cached per area for 6 hours so the same neighborhood doesn't burn
// fresh tokens on every page load.

export interface AITip {
  id: string;
  title: string;
  body: string;
  source: string;
  sourceUrl: string;
  group: "prevention" | "self-defense" | "civic";
  /// Which top offense this tip addresses, for the UI to show alongside.
  addresses?: string;
}

// Permissive schema — accept whatever the model emits as long as the core
// fields are present. Groq's Llama and Gemini Flash both sometimes overshoot
// the body length, drop the optional addresses field, or emit slightly
// different group strings. We coerce/repair downstream rather than reject.
const TipsSchema = z.array(
  z.object({
    title:  z.string().min(2),
    body:   z.string().min(10),
    source: z.string().min(2).optional().default("Official safety guidance"),
    sourceUrl: z.string().optional().default("https://www.ready.gov/"),
    group:  z.string().optional().default("prevention"),
    addresses: z.string().optional(),
  }),
).min(1).max(20);

// 6-hour in-memory cache per area. Vercel functions reuse warm instances,
// so this gets hits within a region across many users.
interface CacheEntry { fetchedAt: number; tips: AITip[] }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Module-level last-call telemetry surfaced via /api/diag/tips so we can see
// what the model actually returned when generation fails to produce >= 6 tips.
let __lastRaw = "";
let __lastStripped = "";
let __lastParseError: string | null = null;
export function getAITipsDebug() {
  return { lastRaw: __lastRaw.slice(0, 600), lastStripped: __lastStripped.slice(0, 600), lastParseError: __lastParseError };
}

const TRUSTED_SOURCES = [
  "FBI Crime Prevention",
  "FBI — Safety Resources",
  "U.S. Postal Inspection Service",
  "National Crime Prevention Council (NCPC)",
  "U.S. Department of Justice — Community Policing (COPS)",
  "U.S. Department of Justice — Office on Violence Against Women",
  "Ready.gov",
  "National Highway Traffic Safety Administration (NHTSA)",
  "National Safety Council",
  "International Association of Chiefs of Police",
  "Crime Stoppers USA",
  "Federal Trade Commission — Consumer Advice",
].join("\n  - ");

const SYSTEM_PROMPT = `
You generate hyper-local safety tips for a specific US neighborhood.

Output: a JSON array of EXACTLY 10 distinct safety tips, no surrounding
prose, no markdown fences. Each tip:
- title: <= 60 characters, action-oriented
- body: 2-3 sentences, plain factual tone, no exclamation marks
- source: name of an OFFICIAL government, law-enforcement, or recognized
  non-profit safety organization. Use one of these unless a city-specific
  source is more appropriate:
  - ${TRUSTED_SOURCES}
- sourceUrl: a real public URL on the source's website. Prefer the
  agency's safety / crime-prevention landing page (e.g.
  https://www.fbi.gov/how-we-can-help-you/safety-resources for FBI,
  https://www.uspis.gov/news/scam-article/package-theft for USPS, etc.)
  Never invent URLs.
- group: prevention | self-defense | civic
- addresses (optional): the specific offense from the listed top offenses
  this tip addresses, copied verbatim

Hard rules:
1. EACH tip must address one or more of the area's listed top offenses,
   or the broader NIBRS category (Persons / Property / Society) the
   neighborhood skews toward. Cite the offense by name in the body where
   it's natural — never say "in your neighborhood" generically.
2. NEVER make demographic claims (race, ethnicity, religion, age, gender,
   orientation). NEVER profile.
3. NEVER encourage users to confront, follow, film, livestream, or
   otherwise approach any individual. Direct to 911 for emergencies, and
   to the city's police non-emergency line for non-emergencies.
4. NEVER recommend vigilantism, citizen-arrest, weapons beyond what is
   commonly legal, or actions a private person cannot lawfully take.
5. Tips must be PRACTICAL for an individual resident — not advice for
   police or city government to act.
6. Mix the 10 tips across prevention (~7) / self-defense (~2) / civic
   (~1) groups. Don't dump them all in one group.
7. No two tips should overlap substantially. If two tips would cover the
   same offense, address it from different angles (prevention vs reporting
   vs aftermath).
`.trim();

export async function generateAITipsForArea(area: string): Promise<AITip[]> {
  if (!aiConfigured()) return [];
  const cached = cache.get(area);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.tips;

  const city = cityForArea(area);
  const mix = await getCrimeMix(area).catch(() => null);
  const top = mix?.topOffenses ?? [];
  if (top.length === 0) return [];

  const counts = top.slice(0, 8).map((o) => `- ${o.offense} (${o.category.toLowerCase()}, ${o.count} reports)`).join("\n");
  const dominant = (() => {
    const c = { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 };
    for (const o of top) c[o.category] += o.count;
    return (Object.entries(c) as Array<["PERSONS"|"PROPERTY"|"SOCIETY", number]>).sort((a,b)=>b[1]-a[1])[0]?.[0] ?? "PROPERTY";
  })();

  const userPrompt = `
City: ${city.label}
Neighborhood: ${area}
Dominant NIBRS category: ${dominant}
Total recent incidents in area: ${mix?.totalIncidents ?? 0}
Window: ${mix?.windowDays ?? "recent cached"} days

Top reported offenses in this neighborhood:
${counts}

Generate the JSON array now.
`.trim();

  let raw = "";
  try {
    const model = await getAIModel();
    if (!model) return [];
    const { generateText } = await import("ai");
    const res = await generateText({
      model: model as Parameters<typeof generateText>[0]["model"],
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.4,
    });
    raw = res.text;
  } catch (err) {
    console.warn("[ai-tips] generation failed:", (err as Error).message);
    return [];
  }

  // Strip any accidental markdown fence the model might wrap around the JSON,
  // and pull the first JSON array out of the response (Groq + Llama sometimes
  // prefix prose like "Here's the JSON:" before emitting the array).
  let stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const firstBracket = stripped.indexOf("[");
  const lastBracket = stripped.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    stripped = stripped.slice(firstBracket, lastBracket + 1);
  }
  __lastRaw = raw;
  __lastStripped = stripped;
  let parsed: z.infer<typeof TipsSchema>;
  try {
    const json = JSON.parse(stripped);
    parsed = TipsSchema.parse(json);
  } catch (err) {
    __lastParseError = `${(err as Error).name}: ${(err as Error).message}`;
    console.warn("[ai-tips] parse failed:", (err as Error).message, "raw:", stripped.slice(0, 200));
    return [];
  }

  const tips: AITip[] = parsed.map((t, i) => {
    // Coerce the model's group string to our 3-value enum.
    const g = (t.group || "").toLowerCase();
    const group: "prevention" | "self-defense" | "civic" =
      g.includes("self") || g.includes("defense") ? "self-defense" :
      g.includes("civic") || g.includes("community") ? "civic" : "prevention";
    return {
      id: `ai-${area}-${i}`,
      title:  t.title.trim().slice(0, 80),
      body:   t.body.trim().slice(0, 800),
      source: t.source || "Official safety guidance",
      // Force a valid http(s) URL — strip anything malformed.
      sourceUrl: /^https?:\/\//.test(t.sourceUrl || "") ? t.sourceUrl! : "https://www.ready.gov/",
      group,
      addresses: t.addresses,
    };
  });

  cache.set(area, { fetchedAt: Date.now(), tips });
  return tips;
}
