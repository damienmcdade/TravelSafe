import { PostFlagKind } from "@/generated/prisma/client";
import { containsProfanity } from "./profanity";

// Pre-vetter — relaxed policy with an anti-bias guardrail.
//
// Per current product direction, anonymous posts auto-publish; the pre-vetter
// blocks a narrow set of content:
//   1. Vulgar / profane language
//   2. Direct or implied threats of violence
//   3. Racial / demographic profiling — a "suspicious person" report whose
//      ONLY basis is the person's race/ethnicity/skin color, with no described
//      behavior. (Citizen and especially Ring/Neighbors are widely criticized
//      for enabling racial profiling; enforcing "describe the ACTION, not the
//      person's appearance" in code is a deliberate trust differentiator.)
//
// Length sanity checks (min/max) still apply so the feed doesn't fill with
// empty or pasted-novel posts. Addresses / names are not enforced by code.

export const POST_MIN_LEN = 20;
export const POST_MAX_LEN = 1000;
export const POST_RATE_LIMIT_PER_DAY = 20;
export const REPORT_AUTO_REVERT_THRESHOLD = 3;

// Direct or implied threat language — kept as a HARD BLOCK now (was a hold).
const THREAT =
  /\b(?:going to|gonna|will|i['']ll)\s+(?:kill|hurt|beat|shoot|stab|attack|burn|destroy)\b|\b(?:teach .* a lesson|go after (?:him|her|them)|catch (?:him|her|them))\b|\bdeath threat\b/i;

// Slurs / profanity is handled by the separate containsProfanity() check.

// --- Anti-profiling guardrail ----------------------------------------------
// Triggers ONLY when all three hold, to avoid blocking legitimate reports:
//   (a) the post describes a PERSON by race/ethnicity/skin color,
//   (b) framed as suspicion ("suspicious", "doesn't belong", "sketchy"…),
//   (c) WITHOUT any concrete behavior/action (broke in, stole, followed me…).
// A report that names an actual action is always allowed, even if it also
// mentions race — the goal is "actions, not appearance," not erasing detail.
const RACE_PERSON =
  /\b(black|white|brown|asian|hispanic|latino|latina|latinx|middle[-\s]?eastern|arab|arabic|african[-\s]?american|caucasian|indian|native|oriental|dark[-\s]?skinned|light[-\s]?skinned)\s+(?:guy|man|men|woman|women|male|males|female|females|person|persons|people|teen|teens|teenager|kid|kids|boy|boys|girl|girls|individual|individuals|dude|guys|youth|youths|suspect|suspects|fella)\b|\b(?:guy|man|woman|male|female|person|people|teen|kid|boy|girl|individual|suspect)s?\s+(?:who(?:'?s| is| was| are| were)?\s+)?(?:looked?\s+)?(black|white|brown|asian|hispanic|latino|latina|middle[-\s]?eastern|arab|african[-\s]?american|caucasian|dark[-\s]?skinned|light[-\s]?skinned)\b/i;
const SUSPICION =
  /\b(?:suspicious|sketchy|shady|lurking|loitering|prowling|casing|creepy|out of place|up to no good|doesn'?t belong|don'?t belong|do not belong|didn'?t belong|shouldn'?t be (?:here|there)|not from (?:here|around|this)|looked? like (?:he|she|they|trouble|a criminal)|seemed? off|gave me a (?:bad|weird) (?:feeling|vibe))\b/i;
const CONCRETE_ACTION =
  /\b(?:broke|breaking|break[-\s]?in|stole|stealing|steal|theft|stolen|robbed|robbery|mugg|burglar|entered|trespass|vandaliz|graffiti|spray[-\s]?paint|assault|attack|punch|hit|stab|shot|shoot|yell|scream|threaten|threat|follow|followed|chased?|chasing|damaged?|smashed?|kicked?|shoplift|brandish|weapon|gun|knife|firearm|drug deal|deal(?:ing)? drugs|exposed?|peeping|slashed?|tampered?|pried|jumped the fence|knocked on|rang the|tried (?:the|to)|package|porch pirate|car door|window)\b/i;

export interface PreVetFlag {
  kind: PostFlagKind;
  detail?: string;
  action: "block";
}

export interface PreVetResult {
  /** Should we refuse to insert this post at all? */
  block: boolean;
  /** Legacy field — anonymous posts no longer use a hold/review queue. Always false. */
  hold: boolean;
  flags: PreVetFlag[];
  /** Inline guidance for the submission UI on the first block hit. */
  inlineGuidance?: string;
}

const GUIDANCE = {
  short: `Posts must be at least ${POST_MIN_LEN} characters so they carry useful context.`,
  long: `Posts must be under ${POST_MAX_LEN} characters.`,
  threat: "CommunitySafe does not allow posts that threaten violence or call for retaliation. Describe what you saw, not what you would do.",
  profanity: "Please rephrase without profanity or slurs.",
  profiling: "Describe what the person was DOING, not their race, ethnicity, or skin color. A report that someone looked “suspicious” based only on their appearance isn’t allowed — tell us the specific behavior you witnessed (e.g. “tried car door handles,” “took a package off a porch”).",
} as const;

// Comments are short replies, so they use a lower minimum than posts (which need
// the 20-char floor to carry useful context). All the SUBSTANTIVE checks
// (threat/profanity/address/plate/phone/name/appearance) still apply identically.
export const COMMENT_MIN_LEN = 2;
export const COMMENT_MAX_LEN = 500;

export function preVetPost(body: string, opts: { minLen?: number; maxLen?: number } = {}): PreVetResult {
  const minLen = opts.minLen ?? POST_MIN_LEN;
  const maxLen = opts.maxLen ?? POST_MAX_LEN;
  const flags: PreVetFlag[] = [];
  let block = false;
  let inlineGuidance: string | undefined;

  if (body.length < minLen) {
    flags.push({ kind: PostFlagKind.TOO_SHORT, action: "block", detail: `min ${minLen} chars` });
    block = true;
    inlineGuidance ??= minLen === POST_MIN_LEN ? GUIDANCE.short : `Please write at least ${minLen} characters.`;
  }
  if (body.length > maxLen) {
    flags.push({ kind: PostFlagKind.TOO_LONG, action: "block", detail: `max ${maxLen} chars` });
    block = true;
    inlineGuidance ??= maxLen === POST_MAX_LEN ? GUIDANCE.long : `Please keep it under ${maxLen} characters.`;
  }

  if (THREAT.test(body)) {
    flags.push({ kind: PostFlagKind.THREAT_LANGUAGE, action: "block" });
    block = true;
    inlineGuidance ??= GUIDANCE.threat;
  }

  const prof = containsProfanity(body);
  if (prof.hit) {
    flags.push({ kind: PostFlagKind.PROFANITY, action: "block", detail: prof.matched });
    block = true;
    inlineGuidance ??= GUIDANCE.profanity;
  }

  // Anti-profiling: appearance-based suspicion with no described behavior.
  if (RACE_PERSON.test(body) && SUSPICION.test(body) && !CONCRETE_ACTION.test(body)) {
    flags.push({ kind: PostFlagKind.PROFILING_BY_APPEARANCE, action: "block" });
    block = true;
    inlineGuidance ??= GUIDANCE.profiling;
  }

  return { block, hold: false, flags, inlineGuidance };
}
