/// User-facing rename layer for raw offense strings from police feeds.
///
/// Some upstream NIBRS labels read poorly to a non-specialist:
///   - "Simple Assault" sounds dismissive of the victim's experience —
///     every assault is serious. NIBRS uses "simple" only as a
///     technical contrast to "aggravated" (no weapon, no serious
///     bodily injury). The CommunitySafe UI says "Non-Aggravated
///     Assault" instead.
///   - "All Other Offenses" is the FBI's NIBRS 90Z catch-all bucket.
///     The string tells the user nothing about what's actually inside.
///     The UI renders it as "Other Offenses (NIBRS Group B)" so the
///     reader at least knows it's a remainder category rather than a
///     specific crime.
///
/// The mapping is intentionally case-insensitive and whitespace-tolerant
/// because adapters publish offense names in slightly different shapes
/// (ALL-CAPS Chicago, Title-Case Cleveland, snake_cased SDPD).
///
/// This layer ONLY changes the rendered display label. The underlying
/// `ibrOffenseDescription` field is preserved unchanged so downstream
/// analytics, exports, and NIBRS-classified safety scoring continue to
/// reference the official term.

interface LabelRule {
  /** Regex against the normalized (lowercased, alphanumeric-only) raw label. */
  match: RegExp;
  display: string;
}

const RULES: LabelRule[] = [
  // Order matters: more specific first.
  { match: /^aggravatedassault$|aggravatedassaultandbattery|^assaultaggravated$/, display: "Aggravated Assault" },
  { match: /^simpleassault$|^assaultsimple$|^misdemeanorassault$|^nonaggravatedassault$|^offensivecontact$/, display: "Non-Aggravated Assault" },
  { match: /^allotheroffenses?$|^othercrime$|^miscellaneous(offenses?|crime)?$|^groupb(offenses?)?$/, display: "Other Offenses (NIBRS Group B)" },
  { match: /^sexoffenses?$/, display: "Sex Offense" },
  { match: /^theftof(motorvehicle)?partsoraccessories$|^theftofmotorvehiclepartsoraccessories$/, display: "Theft of Vehicle Parts / Accessories" },
  { match: /^drugnarcoticviolations?$|^drugnarcoticoffense$/, display: "Drug / Narcotic Violation" },
  { match: /^drivingundertheinfluence$/, display: "Driving Under the Influence" },
  { match: /^drugequipmentviolations?$/, display: "Drug Equipment Violation" },
  { match: /^liquorlawviolations?$/, display: "Liquor-Law Violation" },
  { match: /^familyoffensesnonviolent$/, display: "Family Offense (Non-Violent)" },
];

/// Returns the user-facing display label for a raw upstream offense
/// description. If no rule matches, the raw string is title-cased and
/// any standalone "Simple" prefix is replaced with "Non-Aggravated"
/// so we never surface the word "simple" in front of a crime to a
/// user, even when the upstream label is something we don't know.
export function displayOffenseLabel(raw: string): string {
  if (!raw) return "Unknown";
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const rule of RULES) {
    if (rule.match.test(normalized)) return rule.display;
  }
  // Fallback — title-case the raw and replace any "simple" prefix.
  const titled = raw
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  return titled.replace(/^Simple\b/, "Non-Aggravated").replace(/\bSimple Assault\b/g, "Non-Aggravated Assault");
}
