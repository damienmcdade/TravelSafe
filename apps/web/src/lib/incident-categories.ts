/// Personalized incident categories — orthogonal to the FBI's NIBRS
/// Persons/Property/Society grouping. These are USER-FACING categories
/// that map to specific safety concerns ("women's safety", "nightlife",
/// "scams") rather than the FBI's classification taxonomy. Used by the
/// CrimeMixCard's filter chips so a user can narrow the displayed
/// offenses to ONLY those relevant to their safety concern.
///
/// Each category's `match(desc)` runs a regex test against the raw
/// offense description published by the underlying police feed. The
/// regexes are intentionally permissive — different adapters publish
/// offenses with different wording (NYPD "ASSAULT 3", SDPD "SIMPLE
/// ASSAULT", LAPD "242 - PC - M - Battery On Person - Simple - 13B"),
/// so a single regex needs to catch all variants.

export interface IncidentCategory {
  id: string;
  label: string;
  description: string;
  /// Returns true when the offense description belongs to this
  /// category. May overlap with other categories — a sex offense
  /// matches both "women's safety" and "violent", and that's the
  /// desired behavior (a user filtering for women's safety sees
  /// all such offenses regardless of their NIBRS Part 1 status).
  match: (offenseDescription: string) => boolean;
}

const TEST = (patterns: RegExp[], desc: string): boolean => {
  for (const p of patterns) if (p.test(desc)) return true;
  return false;
};

export const INCIDENT_CATEGORIES: IncidentCategory[] = [
  {
    id: "all",
    label: "All offenses",
    description: "Every offense the city's police feed publishes — no client-side filter applied.",
    match: () => true,
  },
  {
    id: "violent",
    label: "Violent crime",
    description: "Crimes targeting a person directly: murder, rape, robbery, aggravated assault, kidnapping, weapons-involved incidents.",
    match: (d) => TEST([
      /\bmurder\b/i, /\bhomicide\b/i, /\bmanslaughter\b/i,
      /\brape\b/i, /\bsexual assault\b/i,
      /\brobbery\b/i, /\bcarjack/i,
      /\bassault\b/i, /\bbattery\b/i,
      /\bshooting\b/i, /\bshot\b/i, /\bstab/i,
      /\bweapon\b/i, /\bfirearm\b/i, /\bgun\b/i,
      /\bkidnap/i, /\babduct/i,
    ], d),
  },
  {
    id: "theft",
    label: "Theft & burglary",
    description: "Property taken without confrontation: burglary, larceny, vehicle theft, shoplifting, package theft.",
    match: (d) => TEST([
      /\bburglary\b/i, /\bbreaking.*entering\b/i, /\bb&e\b/i,
      /\blarceny\b/i, /\btheft\b/i, /\bstolen\b/i, /\bsteal/i,
      /\bshoplift/i,
      /motor vehicle theft/i, /\bauto theft\b/i, /vehicle theft/i,
      /\bpocket picking\b/i, /\bpurse snatch/i,
    ], d),
  },
  {
    id: "scams",
    label: "Scams & fraud",
    description: "Financial deception, identity theft, credit-card fraud, forgery, counterfeiting, wire fraud, and confidence schemes.",
    match: (d) => TEST([
      /\bfraud\b/i, /forgery/i, /counterfeit/i,
      /identity theft/i, /credit card/i,
      /embezzle/i, /false pretenses/i,
      /\bswindle/i, /confidence/i,
      /wire fraud/i, /cybercrime/i, /impersonation/i,
    ], d),
  },
  {
    id: "womens-safety",
    label: "Women's safety",
    description: "Sex offenses, sexual assault, domestic violence, stalking, harassment, intimidation — incidents disproportionately affecting women.",
    match: (d) => TEST([
      /\brape\b/i, /\bsexual\b/i, /\bsex offense\b/i, /\bsodomy\b/i, /\bfondl/i,
      /\bharassment\b/i, /\bharrassment\b/i,
      /\bstalking\b/i, /\bmenacing\b/i,
      /\bdomestic\b/i, /\bintimate partner\b/i,
      /\bhuman traffick/i,
      /\bstrangulation\b/i, /\bstrangle\b/i,
    ], d),
  },
  {
    id: "nightlife",
    label: "Nightlife",
    description: "DUI, public intoxication, liquor-law violations, disorderly conduct, fights and disturbances — late-hour public-order offenses.",
    match: (d) => TEST([
      /\bdui\b/i, /\bdwi\b/i, /\bdriving.*under.*influence\b/i,
      /\bintoxication\b/i, /\bdrunk/i,
      /\bliquor\b/i, /\balcohol\b/i,
      /\bdisorderly\b/i, /\bdisturbance\b/i,
      /\bfight\b/i, /\baffray\b/i,
      /\bnoise\b/i,
    ], d),
  },
  {
    id: "transit",
    label: "Transit & vehicle",
    description: "Vehicle break-ins, carjacking, traffic-related incidents, and offenses occurring on or near public transit.",
    match: (d) => TEST([
      /vehicle/i, /\bauto\b/i, /\bcar\b/i,
      /\bcarjack/i,
      /\btransit\b/i, /\bsubway\b/i, /\bbus\b/i, /\btrain\b/i,
      /\bhit.*run\b/i, /\bhit and run\b/i,
      /\btraffic\b/i,
    ], d),
  },
  {
    id: "vandalism",
    label: "Vandalism",
    description: "Property destruction, graffiti, criminal mischief, and damage to private or public property.",
    match: (d) => TEST([
      /vandal/i,
      /destruction.*property/i, /damage.*property/i,
      /criminal mischief/i,
      /graffiti/i,
    ], d),
  },
  {
    id: "drugs",
    label: "Drugs",
    description: "Drug possession, distribution, manufacturing, and narcotic-related offenses.",
    match: (d) => TEST([
      /\bdrug\b/i, /\bnarcotic\b/i, /controlled substance/i,
      /\bpossession\b/i,
      /\bcannabis\b/i, /\bmarijuana\b/i,
      /\bmethamphetamine\b/i, /\bcocaine\b/i, /\bheroin\b/i, /\bopioid/i, /\bfentanyl\b/i,
    ], d),
  },
  {
    id: "tourist-scams",
    label: "Tourist scams",
    description: "Fraud schemes that disproportionately target visitors — pickpocketing, distraction theft, fake-officer demands, currency-exchange fraud, taxi/rideshare scams.",
    match: (d) => TEST([
      /pickpocket/i, /\bdistraction\b/i, /\bsnatch/i,
      /\bcounterfeit\b/i, /\bcurrency\b/i,
      /\bsolicitation\b/i, /\bunlicensed\b/i,
      /\bsleight\b/i, /\bswindle/i, /\bconfidence game\b/i,
      /\bfake.*officer\b/i, /\bimpersonat/i,
    ], d),
  },
  {
    id: "traffic-hazards",
    label: "Traffic hazards",
    description: "Reckless or hazardous driving, hit-and-run, pedestrian-struck incidents, street-racing — events that change which routes are safe to walk or drive.",
    match: (d) => TEST([
      /reckless drive/i, /reckless driving/i,
      /\bhit.*run\b/i, /\bhit and run\b/i,
      /pedestrian.*struck/i, /\bped struck/i,
      /\bstreet rac/i, /\bracing\b/i,
      /\btraffic accident/i, /\bcollision\b/i,
      /\bspeeding\b/i,
    ], d),
  },
  {
    id: "protests",
    label: "Protests",
    description: "Demonstrations, rallies, civil unrest, road closures and crowd-control events — useful for travelers planning around large gatherings.",
    match: (d) => TEST([
      /\bprotest/i, /\brally/i, /\bdemonstration\b/i, /\bmarch\b/i,
      /\bunrest\b/i, /\briot/i,
      /\bcrowd\b/i, /\bassembly\b/i,
      /\bstreet closure\b/i,
    ], d),
  },
  // No "weather" matcher — weather alerts come from a separate
  // pipeline (NWS via /api/official-alerts → Weather card). Filtering
  // the police-incident feed for weather keywords would produce
  // noise (officers do file weather-related reports occasionally —
  // e.g., DUI in a storm — but those aren't actually weather alerts).
];

/// Lookup a category by ID. Returns the "all" category as a safe
/// fallback for unknown IDs (e.g., a stale localStorage entry that
/// references a category we've since renamed).
export function getIncidentCategory(id: string): IncidentCategory {
  return INCIDENT_CATEGORIES.find((c) => c.id === id) ?? INCIDENT_CATEGORIES[0];
}
