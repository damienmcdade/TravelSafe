// Minimal seed list to make the filter functional. Intentionally short so this
// file can be reviewed in a PR — production deployments should swap in a
// maintained word list / ML classifier behind the same interface.
const SEED = [
  "asshole", "bastard", "bitch", "bullshit", "cunt", "dick", "fag", "fuck",
  "motherfucker", "nigger", "piss", "prick", "pussy", "shit", "slut", "whore",
];

const PATTERNS = SEED.map((w) => new RegExp(`\\b${w}\\b`, "i"));

export function containsProfanity(text: string): { hit: boolean; matched?: string } {
  for (const r of PATTERNS) {
    const m = text.match(r);
    if (m) return { hit: true, matched: m[0].toLowerCase() };
  }
  return { hit: false };
}
