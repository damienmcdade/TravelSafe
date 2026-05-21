import { PostFlagKind } from "@prisma/client";
import { containsProfanity } from "./profanity";

// Balanced defaults — confirmed with the user before implementation.
// See README "Mod policy: Balanced defaults".

export const POST_MIN_LEN = 50;
export const POST_MAX_LEN = 800;
export const POST_RATE_LIMIT_PER_DAY = 5;
export const REPORT_AUTO_REVERT_THRESHOLD = 3;

// --- Detector regexes -------------------------------------------------------

// Street address — number(s) followed by a word and a common street suffix.
const STREET_ADDRESS = /\b\d{1,5}\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Pl|Place|Way|Pkwy|Parkway|Hwy|Highway)\b\.?/i;

// US phone number, with or without country code, punctuation tolerant.
const PHONE = /(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/;

// California license plate shapes (broad, biased false-positive-tolerant).
const LICENSE_PLATE = /\b(?:\d[A-Z]{3}\d{3}|[A-Z]{3}\d{3,4})\b/;

// Name + accusation: two consecutive capitalized words near a violent/criminal verb.
const NAME_AND_ACCUSATION =
  /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b[^.]{0,80}\b(?:stole|attacked|assault(?:ed)?|robbed|broke into|harassed|threatened|abused|hit|hurt|killed)\b/i;

// Direct or implied threat language.
const THREAT =
  /\b(?:going to|gonna|will)\s+(?:kill|hurt|beat|shoot|stab|attack)\b|\b(?:teach .* a lesson|go after (?:him|her|them))\b/i;

// Profiling — anywhere in the post, language that primarily classifies a
// person by race, ethnicity, religion, or perceived national origin. The list
// is broad on purpose: any hit triggers a HOLD (not a silent block) so a
// human reviewer can confirm. UI guidance steers users toward behavior+place.
const DEMOGRAPHIC_DESCRIPTOR =
  /\b(?:black|white|brown|asian|latino|latina|latinx|hispanic|middle[- ]eastern|arab|muslim|jewish|christian|indian|african|mexican|chinese|japanese|korean|filipino)\s+(?:man|woman|guy|girl|kid|teen|teenager|boy|male|female|person|people|individual|individuals)\b/i;

// Same as above, but at the start of the post — "a black man was…" is the
// classic profiling lede that needs intercepting up front.
const APPEARANCE_LED =
  /^\s*(?:a |an |the )?(?:black|white|brown|asian|latino|hispanic|middle[- ]eastern|arab|tall|short|fat|skinny|young|old)\s+(?:man|woman|guy|girl|kid|teen|teenager|boy)\b/i;

// "Suspicious person who didn't belong" — no described behavior. Pattern: the
// word "suspicious"/"out of place"/"doesn't belong" without a co-occurring
// behavior verb (walking, running, looking, knocking, taking, etc).
const SUSPICION_WITHOUT_BEHAVIOR =
  /\b(?:suspicious|out of place|does(?:n['’]t| not) belong|looked wrong|something off about)\b/i;
const BEHAVIOR_VERB =
  /\b(?:walking|running|loitering|knocking|peering|taking|carrying|driving|parked|yelling|filming|recording|leaning|reaching|trying|broke|breaking|entered|entering|approached|approaching|threw|throwing|hit|kicked|grabbed|followed|following)\b/i;

// Anti-vigilante: explicit calls to confront, "deal with," livestream, or
// surveil. Always HOLD.
const VIGILANTE =
  /\b(?:go film|live[- ]?stream|confront|deal with (?:him|her|them|this)|teach .* a lesson|catch (?:him|her|them) in the act|stake out|tail (?:him|her|them))\b/i;

export interface PreVetFlag {
  kind: PostFlagKind;
  detail?: string;
  action: "block" | "hold";
}

export interface PreVetResult {
  /** Should we refuse to insert this post at all? (block-list hit) */
  block: boolean;
  /** Should we accept-but-hold for human review? (hold-list hit) */
  hold: boolean;
  flags: PreVetFlag[];
  /** Inline guidance for the submission UI on the first block hit. */
  inlineGuidance?: string;
}

const GUIDANCE = {
  address: "Describe the area and behavior, not a specific street address. Remove the address and try again.",
  phone: "Please remove the phone number. Community posts should not contain contact info.",
  plate: "Please remove the license plate. Report plates directly to the police, not in a community post.",
  demographics: "Describe behavior, location, and time — not someone's race, ethnicity, religion, or appearance.",
  appearance: "Describe behavior and location, not a person's appearance.",
  vague: "Describe the specific behavior you observed (e.g. 'trying door handles', 'taking packages') — 'suspicious' alone isn't enough to post.",
  threat: "Calls to confront or retaliate are not allowed. Rephrase to describe what you saw, not what you'd do.",
  vigilante: "TravelSafe does not coordinate confronting, filming, or following individuals. Describe what you saw and report serious incidents to the police.",
  nameAccusation: "Please don't name an individual. Describe the behavior and location instead.",
} as const;

export function preVetPost(body: string): PreVetResult {
  const flags: PreVetFlag[] = [];
  let block = false;
  let hold = false;
  let inlineGuidance: string | undefined;

  if (body.length < POST_MIN_LEN) {
    flags.push({ kind: PostFlagKind.TOO_SHORT, action: "block", detail: `min ${POST_MIN_LEN} chars` });
    block = true;
    inlineGuidance ??= `Posts must be at least ${POST_MIN_LEN} characters.`;
  }
  if (body.length > POST_MAX_LEN) {
    flags.push({ kind: PostFlagKind.TOO_LONG, action: "block", detail: `max ${POST_MAX_LEN} chars` });
    block = true;
    inlineGuidance ??= `Posts must be under ${POST_MAX_LEN} characters.`;
  }

  if (STREET_ADDRESS.test(body)) {
    flags.push({ kind: PostFlagKind.ADDRESS_DETECTED, action: "block" });
    block = true;
    inlineGuidance ??= GUIDANCE.address;
  }
  if (PHONE.test(body)) {
    flags.push({ kind: PostFlagKind.PHONE_DETECTED, action: "block" });
    block = true;
    inlineGuidance ??= GUIDANCE.phone;
  }
  if (LICENSE_PLATE.test(body)) {
    flags.push({ kind: PostFlagKind.PLATE_DETECTED, action: "block" });
    block = true;
    inlineGuidance ??= GUIDANCE.plate;
  }

  if (NAME_AND_ACCUSATION.test(body)) {
    flags.push({ kind: PostFlagKind.NAME_AND_ACCUSATION, action: "hold" });
    hold = true;
    inlineGuidance ??= GUIDANCE.nameAccusation;
  }
  if (THREAT.test(body)) {
    flags.push({ kind: PostFlagKind.THREAT_LANGUAGE, action: "hold" });
    hold = true;
    inlineGuidance ??= GUIDANCE.threat;
  }
  if (APPEARANCE_LED.test(body) || DEMOGRAPHIC_DESCRIPTOR.test(body)) {
    flags.push({
      kind: PostFlagKind.PROFILING_BY_APPEARANCE,
      action: "hold",
      detail: APPEARANCE_LED.test(body) ? "appearance_led" : "demographic_descriptor",
    });
    hold = true;
    inlineGuidance ??= GUIDANCE.demographics;
  }

  if (SUSPICION_WITHOUT_BEHAVIOR.test(body) && !BEHAVIOR_VERB.test(body)) {
    flags.push({ kind: PostFlagKind.THREAT_LANGUAGE, action: "hold", detail: "vague_suspicion_no_behavior" });
    hold = true;
    inlineGuidance ??= GUIDANCE.vague;
  }

  if (VIGILANTE.test(body)) {
    flags.push({ kind: PostFlagKind.THREAT_LANGUAGE, action: "hold", detail: "vigilante_language" });
    hold = true;
    inlineGuidance ??= GUIDANCE.vigilante;
  }

  const prof = containsProfanity(body);
  if (prof.hit) {
    flags.push({ kind: PostFlagKind.PROFANITY, action: "hold", detail: prof.matched });
    hold = true;
  }

  return { block, hold, flags, inlineGuidance };
}
