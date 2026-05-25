// Shared title-case helper for adapter-emitted offense descriptions.
//
// Multiple upstream feeds (Boston, Buffalo, Chicago, Cleveland, Dallas,
// Detroit, Oakland) publish offense names in SHOUTING ALL CAPS — they
// look great in a 1990s mainframe CAD report and absolutely awful in
// CommunitySafe's ThreatFeed. Adapters that pass them through verbatim
// surface things like "ALARM - BURGLAR" and "AGG ASSAULT - NFV" to
// users.
//
// Use titleCaseOffense() at the adapter boundary (where the raw string
// becomes ibrOffenseDescription) so every downstream surface — feed,
// summary card, AI explainer prompt, etc. — sees a normalized form.
//
// Rules:
//  - Lowercase everything first, then capitalize each word's first
//    letter (handles "AGG" → "Agg", "agg" → "Agg" uniformly)
//  - Known acronyms stay uppercase: PD, DUI, OWI, DV, IPV, NFV, BB,
//    UUMV, VSA, MV, RV, NCIC, etc.
//  - Tiny connecting words ("of", "the", "and", "for") stay lowercase
//    unless they're the first word
//  - Hyphenated and apostrophe-joined words capitalize the next letter
//    ("hit-and-run" → "Hit-And-Run", "o'brien" → "O'Brien")
//  - Strip leading numeric offense codes like "406 - " (UCR/CFS codes
//    that occasionally bleed into the description column)

const ACRONYMS = new Set([
  "PD", "DUI", "OWI", "DV", "IPV", "NFV", "BB", "UUMV", "VSA",
  "MV", "RV", "NCIC", "ID", "ATM", "CSC", "LE", "PWID", "SF",
  "FTA", "OCJC", "LSA", "AOA", "POI", "PFA", "DV-IPV",
]);

const SMALL_WORDS = new Set([
  "of", "the", "and", "for", "or", "at", "in", "on", "by", "to", "vs",
]);

// Match a leading numeric code with optional trailing separator:
//   "406 - BURGLARY"   → "BURGLARY"
//   "23-A AGG ASSAULT" → "AGG ASSAULT" (drops 23-A and the space)
//   "1190 LARCENY"     → "LARCENY"
const LEADING_CODE = /^\s*\d+[A-Za-z]?\s*[-:.]?\s+/;

function capWord(w: string): string {
  if (!w) return w;
  const upper = w.toUpperCase();
  if (ACRONYMS.has(upper)) return upper;
  // Re-capitalize after hyphen/apostrophe so "hit-and-run" works.
  return w.toLowerCase().replace(/(^|[-'])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export function titleCaseOffense(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  const stripped = raw.replace(LEADING_CODE, "").trim();
  if (!stripped) return "Unknown";
  const words = stripped.split(/\s+/);
  return words
    .map((w, i) => {
      if (i > 0 && SMALL_WORDS.has(w.toLowerCase())) return w.toLowerCase();
      return capWord(w);
    })
    .join(" ");
}
