import "server-only";
import { z } from "zod";
import { aiConfigured, generateTextWithFallback } from "../ai/provider";
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
    // Llama emits this as an array of offense strings; Gemini as a single
    // string. Accept either and normalize downstream.
    addresses: z.union([z.string(), z.array(z.string())]).optional(),
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
  "U.S. Department of Homeland Security (DHS) — Personal Safety & Situational Awareness",
  "CISA — Active Shooter / Run-Hide-Fight",
  "U.S. Postal Inspection Service",
  "National Crime Prevention Council (NCPC)",
  "U.S. Department of Justice — Community Policing (COPS)",
  "U.S. Department of Justice — Office on Violence Against Women",
  "RAINN — National Sexual Assault Resources",
  "Ready.gov",
  "National Highway Traffic Safety Administration (NHTSA)",
  "National Safety Council",
  "International Association of Chiefs of Police",
  "Crime Stoppers USA",
  "Federal Trade Commission — Consumer Advice",
].join("\n  - ");

// Evidence-based self-defense doctrine, condensed from DHS personal-safety
// guidance, CISA Run-Hide-Fight, and widely-taught de-escalation/avoidance
// frameworks. Injected into the prompt so the model's self-defense tips
// teach the actual hierarchy (avoid > de-escalate > escape > last-resort
// proportional force) rather than generic "take a class" filler. Ordered
// by priority — earlier rungs are always preferred over later ones.
const SELF_DEFENSE_PRINCIPLES = `
  1. AWARENESS — keep your attention on your surroundings, not your phone;
     scan for exits and who is near you. Trusting an instinctive "something
     is wrong" feeling and acting on it early prevents most incidents.
  2. AVOIDANCE — distance and position are your best defense. Cross the
     street, change cars on a train, walk toward lit and populated areas,
     and leave a situation before it escalates. Avoiding a fight always
     beats winning one.
  3. DE-ESCALATION — if approached, use a firm, loud, simple command
     ("Back off", "Leave me alone"), keep open space and a non-threatening
     stance, and do not argue or insult. Calm, assertive body language
     ends many confrontations.
  4. ESCAPE — if it's about property, give it up; belongings are
     replaceable. Getting away to safety and other people is the priority —
     run, make noise, and head for a store, lit area, or crowd.
  5. LAST-RESORT DEFENSE — physical force is only justified against
     imminent harm, must be reasonable and proportional, and is a means to
     create a gap so you can escape — never to "win" or punish. Then call
     911 immediately.
  6. REPORT — call 911 for anything in progress or just happened; use the
     police non-emergency line otherwise; note what you safely can.`;

const SYSTEM_PROMPT = `
You generate hyper-local safety tips for a specific US neighborhood.

Output: a JSON array of EXACTLY 12 distinct safety tips, no surrounding
prose, no markdown fences. Each tip:
- title: <= 60 characters, action-oriented
- body: 2-4 sentences, plain factual tone, no exclamation marks. Be
  SPECIFIC and ACTIONABLE — name the concrete behavior, object, or step
  (e.g. "park under a light and take the charger cable out of sight"),
  not vague advice ("be careful", "stay alert", "take a class").
- source: name of an OFFICIAL government, law-enforcement, or recognized
  non-profit safety organization. Use one of these unless a city-specific
  source is more appropriate:
  - ${TRUSTED_SOURCES}
- sourceUrl: a real public URL on the source's website. Prefer the
  agency's safety / crime-prevention landing page (e.g.
  https://www.fbi.gov/how-we-can-help-you/safety-resources for FBI,
  https://www.dhs.gov/see-something-say-something for DHS,
  https://www.cisa.gov/resources-tools/resources/options-consideration-active-shooter-preparedness for CISA,
  https://rainn.org/safety-prevention for RAINN,
  https://www.uspis.gov/news/scam-article/package-theft for USPS).
  Never invent URLs.
- group: prevention | self-defense | civic
- addresses (optional): the specific offense from the listed top offenses
  this tip addresses, copied verbatim

SELF-DEFENSE DOCTRINE — the self-defense tips must teach these principles,
in this priority order (avoid/escape always beats fighting). Translate the
relevant rungs into concrete, neighborhood-specific actions:
${SELF_DEFENSE_PRINCIPLES}

Hard rules:
1. TAILOR TO THE DOMINANT CATEGORY. If the neighborhood skews PERSONS
   (assault/robbery/threats), weight toward self-defense doctrine:
   awareness, avoidance/positioning, de-escalation, escape, and the
   non-emergency vs 911 distinction. If it skews PROPERTY (theft,
   burglary, motor-vehicle theft, package theft), weight toward
   prevention via target-hardening and CPTED (Crime Prevention Through
   Environmental Design): lighting, locks, visibility/natural
   surveillance, removing valuables from view, layered deterrents,
   vehicle/package routines. If SOCIETY-heavy, weight situational
   awareness + reporting. ALWAYS include the full self-defense ladder at
   least once regardless of category.
2. EACH tip must address one or more of the listed top offenses, or the
   dominant NIBRS category — cite the offense by name in the body where
   natural; never say "in your neighborhood" generically.
3. NEVER make demographic claims (race, ethnicity, religion, age, gender,
   orientation). NEVER profile.
4. NEVER encourage users to confront, follow, film, livestream, or
   approach any individual. The goal is always distance, de-escalation,
   and escape — never engagement. Direct to 911 for emergencies and the
   police non-emergency line otherwise.
5. NEVER recommend vigilantism, citizen-arrest, pursuing a suspect, or
   weapons/force beyond lawful, reasonable, proportional self-defense used
   only to escape imminent harm.
6. Tips must be PRACTICAL for an individual resident — not advice for
   police or city government to act.
7. Group balance for the 12 tips: ~6 prevention, ~4 self-defense
   (covering the doctrine ladder), ~2 civic/reporting. Don't dump them in
   one group.
8. No two tips should overlap substantially. If two would cover the same
   offense, address it from different angles (prevention vs de-escalation
   vs escape vs reporting vs aftermath).
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

  // v96 — Groq → Gemini → gateway runtime fallback.
  const result = await generateTextWithFallback({
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    temperature: 0.4,
  });
  if (!result) return [];
  const raw = result.text;

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
      addresses: Array.isArray(t.addresses) ? t.addresses.join(", ") : t.addresses,
    };
  });

  cache.set(area, { fetchedAt: Date.now(), tips });
  return tips;
}
