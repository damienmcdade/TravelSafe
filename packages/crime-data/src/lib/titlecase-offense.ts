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

// User-sensitive relabel map for offense descriptions where the raw
// NIBRS / police-feed phrasing reads as harsh or potentially
// re-traumatizing to survivors who scroll the feed. Applied AFTER
// titlecasing so a feed value of "SIMPLE RAPE" becomes "Sexual
// Assault (non-aggravated)" rather than the clinical adjective the
// user reported. Matched on the cased output, case-insensitive.
const SENSITIVE_RELABEL: Array<[RegExp, string]> = [
  [/^simple rape$/i,                    "Sexual Assault (non-aggravated)"],
  [/^simple rape - /i,                  "Sexual Assault — "],
  [/^forcible rape$/i,                  "Sexual Assault"],
  [/^statutory rape$/i,                 "Sexual Assault (statutory)"],
  [/^rape$/i,                           "Sexual Assault"],
  // Some adapters publish "Sex Offense - Forcible" etc.; soften the
  // forcible qualifier which reads as graphic.
  [/forcible sodomy/i,                  "Sexual Assault — Sodomy"],
];

function applySensitiveRelabel(s: string): string {
  for (const [pat, replacement] of SENSITIVE_RELABEL) {
    if (pat.test(s)) {
      if (pat.source.endsWith("$/")) return s.replace(pat, replacement);
      return s.replace(pat, replacement);
    }
  }
  return s;
}

export function titleCaseOffense(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  const stripped = raw.replace(LEADING_CODE, "").trim();
  if (!stripped) return "Unknown";
  const words = stripped.split(/\s+/);
  const titled = words
    .map((w, i) => {
      if (i > 0 && SMALL_WORDS.has(w.toLowerCase())) return w.toLowerCase();
      return capWord(w);
    })
    .join(" ");
  return applySensitiveRelabel(titled);
}
