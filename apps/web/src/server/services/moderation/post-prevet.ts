import { PostFlagKind } from "@/generated/prisma/client";
import { containsProfanity } from "./profanity";

// Pre-vetter — relaxed policy.
//
// Per current product direction, anonymous posts auto-publish; the pre-vetter
// only blocks two narrow classes of content:
//   1. Vulgar / profane language
//   2. Direct or implied threats of violence
//
// Length sanity checks (min/max) still apply so the feed doesn't fill with
// empty or pasted-novel posts. Everything else (addresses, profiling, vague
// suspicion, etc.) is no longer enforced by code per the latest spec.

export const POST_MIN_LEN = 20;
export const POST_MAX_LEN = 1000;
export const POST_RATE_LIMIT_PER_DAY = 20;
export const REPORT_AUTO_REVERT_THRESHOLD = 3;

// Direct or implied threat language — kept as a HARD BLOCK now (was a hold).
const THREAT =
  /\b(?:going to|gonna|will|i['']ll)\s+(?:kill|hurt|beat|shoot|stab|attack|burn|destroy)\b|\b(?:teach .* a lesson|go after (?:him|her|them)|catch (?:him|her|them))\b|\bdeath threat\b/i;

// Slurs / profanity is handled by the separate containsProfanity() check.

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
} as const;

export function preVetPost(body: string): PreVetResult {
  const flags: PreVetFlag[] = [];
  let block = false;
  let inlineGuidance: string | undefined;

  if (body.length < POST_MIN_LEN) {
    flags.push({ kind: PostFlagKind.TOO_SHORT, action: "block", detail: `min ${POST_MIN_LEN} chars` });
    block = true;
    inlineGuidance ??= GUIDANCE.short;
  }
  if (body.length > POST_MAX_LEN) {
    flags.push({ kind: PostFlagKind.TOO_LONG, action: "block", detail: `max ${POST_MAX_LEN} chars` });
    block = true;
    inlineGuidance ??= GUIDANCE.long;
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

  return { block, hold: false, flags, inlineGuidance };
}
