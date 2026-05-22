import "server-only";
import { getCrimeMix } from "../crime-data/mix";
import { cityForArea } from "../crime-data/cities";
import { generateAITipsForArea, type AITip } from "./ai-tips";

// Curated, attributed safety guidance. Sources are official:
//   * Each city's Police Department
//   * FBI, U.S. Postal Inspection Service, Ready.gov
//   * California Penal Code (state law) — only shown to CA cities
//   * California Office of the Attorney General — only shown to CA cities
//
// Each tip can target specific NIBRS offenses, top-level categories, and/or
// a list of cities. The matcher picks tips that fit the user's selected city
// AND the area's actual top offenses. Tips that don't list cities apply
// everywhere; tips that do list cities only show in those cities.
//
// The bulk of the prevention section is generated per-neighborhood by AI
// (see ai-tips.ts) so users see guidance tailored to the actual top reported
// offenses in their area, not a generic boilerplate set. The CA-legal
// section stays curated because it cites verbatim statute and case law.

export type CitySlug =
  | "san-diego" | "los-angeles" | "san-francisco" | "oakland"
  | "chicago" | "seattle" | "new-york" | "denver" | "detroit"
  | "washington-dc" | "boston" | "philadelphia" | "cincinnati"
  | "new-orleans" | "baton-rouge" | "cambridge" | "dallas"
  | "charlotte" | "nashville" | "minneapolis" | "cleveland"
  | "montgomery-county" | "las-vegas" | "boise" | "buffalo" | "tucson";
export type TipGroup = "prevention" | "self-defense" | "ca-legal";

export interface SafetyTip {
  id: string;
  title: string;
  body: string;
  source: string;
  sourceUrl: string;
  group: TipGroup;
  offenseSubstrings?: string[];
  categories?: Array<"PERSONS" | "PROPERTY" | "SOCIETY">;
  cities?: CitySlug[];
}

// City-specific non-emergency contact numbers (each verified against the
// department's own public-information page). Used by the safety tab to show
// the right number for the user's selected city — falls back to the city
// 311/411 line where the police department routes non-emergency intake
// through the city service center.
const NON_EMERGENCY: Record<CitySlug, { line: string; label: string; url: string }> = {
  "san-diego":     { line: "619-531-2000", label: "SDPD non-emergency",   url: "https://www.sandiego.gov/police" },
  "los-angeles":   { line: "877-275-5273", label: "LAPD non-emergency",   url: "https://www.lapdonline.org/" },
  "san-francisco": { line: "415-553-0123", label: "SFPD non-emergency",   url: "https://www.sf.gov/departments/police-department" },
  "oakland":       { line: "510-777-3333", label: "OPD non-emergency",    url: "https://www.oaklandca.gov/departments/police-department" },
  "chicago":       { line: "311",          label: "Chicago Police via 311", url: "https://www.chicago.gov/city/en/depts/cpd.html" },
  "seattle":       { line: "206-625-5011", label: "SPD non-emergency",    url: "https://www.seattle.gov/police" },
  "new-york":      { line: "311",          label: "NYPD via NYC 311",     url: "https://www.nyc.gov/site/nypd/index.page" },
  "denver":        { line: "720-913-2000", label: "DPD non-emergency",    url: "https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Police-Department" },
  "detroit":       { line: "313-267-4600", label: "DPD non-emergency",    url: "https://detroitmi.gov/departments/police-department" },
  "washington-dc": { line: "311",          label: "MPD via DC 311",       url: "https://mpdc.dc.gov/" },
  "boston":        { line: "617-343-4240", label: "BPD non-emergency",    url: "https://www.boston.gov/departments/police" },
  "philadelphia":  { line: "311",          label: "PPD via Philly 311",   url: "https://www.phila.gov/departments/philadelphia-police-department/" },
  "cincinnati":    { line: "513-765-1212", label: "CPD non-emergency",    url: "https://www.cincinnati-oh.gov/police/" },
  "new-orleans":   { line: "504-821-2222", label: "NOPD non-emergency",   url: "https://nola.gov/nopd/" },
  "baton-rouge":   { line: "225-389-2000", label: "BRPD non-emergency",   url: "https://www.brla.gov/2128/Police-Department" },
  "cambridge":     { line: "617-349-3300", label: "Cambridge PD non-emergency", url: "https://www.cambridgepolice.org/" },
  "dallas":        { line: "214-744-4444", label: "DPD non-emergency",    url: "https://www.dallaspolice.net/" },
  "charlotte":     { line: "704-336-7600", label: "CMPD non-emergency",   url: "https://charlottenc.gov/CMPD" },
  "nashville":     { line: "615-862-8600", label: "MNPD non-emergency",   url: "https://www.nashville.gov/departments/police" },
  "minneapolis":   { line: "612-348-2345", label: "MPD non-emergency",    url: "https://www.minneapolismn.gov/government/departments/police-department/" },
  "cleveland":     { line: "216-621-1234", label: "CDP non-emergency",    url: "https://www.clevelandpolice.org/" },
  "montgomery-county": { line: "301-279-8000", label: "MCPD non-emergency", url: "https://www.montgomerycountymd.gov/POL/" },
  "las-vegas":     { line: "702-828-3111", label: "LVMPD non-emergency",  url: "https://www.lvmpd.com/" },
  "boise":         { line: "208-377-6790", label: "BPD non-emergency",    url: "https://www.cityofboise.org/departments/police/" },
  "buffalo":       { line: "716-851-4444", label: "Buffalo PD non-emergency", url: "https://www.buffalony.gov/313/Police-Department" },
  "tucson":        { line: "520-791-4444", label: "TPD non-emergency",    url: "https://www.tucsonaz.gov/Departments/Police" },
};

// City-specific official resource links. These get joined into one or more
// prevention tips per city so users see guidance that names their own police
// department and links to their city's actual crime-prevention / community
// resources page — not the generic FBI page that every city otherwise gets.
const CITY_RESOURCES: Record<CitySlug, { name: string; url: string; programName?: string; programUrl?: string }> = {
  "san-diego":     { name: "San Diego Police Department",    url: "https://www.sandiego.gov/police",         programName: "SDPD Crime Prevention",          programUrl: "https://www.sandiego.gov/police/services/prevention" },
  "los-angeles":   { name: "Los Angeles Police Department",  url: "https://www.lapdonline.org/",             programName: "LAPD Crime Prevention",          programUrl: "https://www.lapdonline.org/crime-prevention/" },
  "san-francisco": { name: "San Francisco Police Department", url: "https://www.sf.gov/departments/police-department", programName: "SFPD SafetyAwareness", programUrl: "https://www.sf.gov/topics/safety-awareness" },
  "oakland":       { name: "Oakland Police Department",      url: "https://www.oaklandca.gov/departments/police-department", programName: "OPD Crime Prevention", programUrl: "https://www.oaklandca.gov/topics/crime-prevention" },
  "chicago":       { name: "Chicago Police Department",      url: "https://www.chicago.gov/city/en/depts/cpd.html", programName: "CPD CAPS (Chicago Alternative Policing Strategy)", programUrl: "https://home.chicagopolice.org/community/caps/" },
  "seattle":       { name: "Seattle Police Department",      url: "https://www.seattle.gov/police",          programName: "SPD Crime Prevention",           programUrl: "https://www.seattle.gov/police/crime-prevention" },
  "new-york":      { name: "New York City Police Department", url: "https://www.nyc.gov/site/nypd/index.page", programName: "NYPD Crime Prevention",         programUrl: "https://www.nyc.gov/site/nypd/services/see-something-say-something/see-something-say-something.page" },
  "denver":        { name: "Denver Police Department",       url: "https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Police-Department", programName: "DPD Community Programs", programUrl: "https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Police-Department/Community" },
  "detroit":       { name: "Detroit Police Department",      url: "https://detroitmi.gov/departments/police-department", programName: "DPD Project Green Light", programUrl: "https://detroitmi.gov/departments/police-department/project-green-light-detroit" },
  "washington-dc": { name: "DC Metropolitan Police Department", url: "https://mpdc.dc.gov/",                  programName: "MPDC Crime Prevention",          programUrl: "https://mpdc.dc.gov/page/crime-prevention" },
  "boston":        { name: "Boston Police Department",       url: "https://www.boston.gov/departments/police", programName: "BPD Crime Prevention",         programUrl: "https://www.boston.gov/departments/police/crime-prevention" },
  "philadelphia":  { name: "Philadelphia Police Department", url: "https://www.phila.gov/departments/philadelphia-police-department/", programName: "PPD Public Safety", programUrl: "https://www.phila.gov/services/safety-emergencies-criminal-records/" },
  "cincinnati":    { name: "Cincinnati Police Department",   url: "https://www.cincinnati-oh.gov/police/",   programName: "CPD Citizens On Patrol",         programUrl: "https://www.cincinnati-oh.gov/police/about-cpd/community-engagement/" },
  "new-orleans":   { name: "New Orleans Police Department",  url: "https://nola.gov/nopd/",                  programName: "NOPD Community Engagement",      programUrl: "https://nola.gov/nopd/community-engagement/" },
  "baton-rouge":   { name: "Baton Rouge Police Department",  url: "https://www.brla.gov/2128/Police-Department", programName: "BRPD Crime Prevention",      programUrl: "https://www.brla.gov/2130/Community-Services" },
  "cambridge":     { name: "Cambridge Police Department",    url: "https://www.cambridgepolice.org/",        programName: "Cambridge PD Community Services", programUrl: "https://www.cambridgepolice.org/community/" },
  "dallas":        { name: "Dallas Police Department",       url: "https://www.dallaspolice.net/",           programName: "DPD Community Affairs",          programUrl: "https://www.dallaspolice.net/about/community-affairs" },
  "charlotte":     { name: "Charlotte-Mecklenburg Police",   url: "https://charlottenc.gov/CMPD",            programName: "CMPD Crime Prevention",          programUrl: "https://charlottenc.gov/CMPD/Pages/CommunityRelations/CrimePrevention.aspx" },
  "nashville":     { name: "Metro Nashville Police Department", url: "https://www.nashville.gov/departments/police", programName: "MNPD Office of Community Engagement", programUrl: "https://www.nashville.gov/departments/police/office-professional-accountability/office-community-engagement" },
  "minneapolis":   { name: "Minneapolis Police Department",  url: "https://www.minneapolismn.gov/government/departments/police-department/", programName: "MPD Crime Prevention", programUrl: "https://www.minneapolismn.gov/resident-services/public-safety/police-public-safety/crime-prevention/" },
  "cleveland":     { name: "Cleveland Division of Police",   url: "https://www.clevelandpolice.org/", programName: "CDP Community Policing", programUrl: "https://www.clevelandpolice.org/about/community" },
  "montgomery-county": { name: "Montgomery County Police Department", url: "https://www.montgomerycountymd.gov/POL/", programName: "MCPD Community Outreach", programUrl: "https://www.montgomerycountymd.gov/POL/community/" },
  "las-vegas":     { name: "Las Vegas Metropolitan Police Department", url: "https://www.lvmpd.com/", programName: "LVMPD Community Engagement", programUrl: "https://www.lvmpd.com/en-us/Pages/Community-Engagement.aspx" },
  "boise":         { name: "Boise Police Department", url: "https://www.cityofboise.org/departments/police/", programName: "BPD Crime Prevention", programUrl: "https://www.cityofboise.org/departments/police/services/crime-prevention/" },
  "buffalo":       { name: "Buffalo Police Department", url: "https://www.buffalony.gov/313/Police-Department", programName: "Buffalo PD Community Engagement", programUrl: "https://www.buffalony.gov/319/Community-Engagement" },
  "tucson":        { name: "Tucson Police Department", url: "https://www.tucsonaz.gov/Departments/Police", programName: "TPD Crime Prevention", programUrl: "https://www.tucsonaz.gov/Departments/Police/Crime-Prevention" },
};

const PREVENTION_TIPS: SafetyTip[] = [
  {
    id: "vehicle-burglary",
    title: "Park smart and leave nothing visible",
    body:
      "Most vehicle break-ins are crimes of opportunity. Move bags, charging cables, and loose change out of sight before leaving the car. Park under streetlights when possible, and lock all doors even for a short stop.",
    source: "FBI — Crime Prevention",
    sourceUrl: "https://www.fbi.gov/how-we-can-help-you/safety-resources",
    group: "prevention",
    offenseSubstrings: ["vehicle", "from auto", "auto theft", "motor vehicle"],
  },
  {
    id: "residential-burglary",
    title: "Make your home look lived-in",
    body:
      "Burglars target homes that look empty. Use timers on interior lights, keep entry points well lit, trim shrubs that hide windows, and ask a trusted neighbor to keep watch when you are away.",
    source: "FBI — Burglary Prevention",
    sourceUrl: "https://www.fbi.gov/how-we-can-help-you/safety-resources",
    group: "prevention",
    offenseSubstrings: ["burglary", "residential burglary"],
  },
  {
    id: "package-theft",
    title: "Discourage package theft",
    body:
      "Schedule deliveries for times when you will be home, require a signature on high-value items, use a locking parcel box, or ship to a verified pickup location. Report thefts to both the carrier and your city's non-emergency police line.",
    source: "U.S. Postal Inspection Service",
    sourceUrl: "https://www.uspis.gov/news/scam-article/package-theft",
    group: "prevention",
    offenseSubstrings: ["theft", "larceny"],
  },
  {
    id: "vandalism",
    title: "Document and report property damage",
    body:
      "If you find graffiti or damage on your property: photograph it before cleanup, file a report with your city's police non-emergency line, and submit a 311 request so the city can prioritize area maintenance.",
    source: "U.S. Department of Justice — Community Policing",
    sourceUrl: "https://cops.usdoj.gov/",
    group: "prevention",
    offenseSubstrings: ["vandalism", "destruction", "damage"],
  },
  {
    id: "assault-awareness",
    title: "Stay aware in transition zones",
    body:
      "Many assaults occur near transit stops, parking structures, and ATMs after dark. Travel with company when possible, keep your phone pocketed at street crossings, and leave any situation that feels off.",
    source: "National Crime Prevention Council",
    sourceUrl: "https://www.ncpc.org/resources/personal-safety/",
    group: "prevention",
    offenseSubstrings: ["assault", "battery", "robbery", "intimidation"],
    categories: ["PERSONS"],
  },
  {
    id: "robbery",
    title: "If confronted, comply and call 911",
    body:
      "Property is replaceable. If someone demands cash, a phone, or a bag, give it up calmly, move to a safe distance, and call 911. Note the direction of travel, clothing, and any vehicle details rather than focusing on facial features.",
    source: "FBI — Safety Resources",
    sourceUrl: "https://www.fbi.gov/how-we-can-help-you/safety-resources",
    group: "prevention",
    offenseSubstrings: ["robbery"],
    categories: ["PERSONS"],
  },
  {
    id: "drug-activity",
    title: "Report ongoing drug activity to the right channel",
    body:
      "Sustained dealing or open use in a public space can be reported to your city's police non-emergency line or anonymously through a local Crime Stoppers program. Do not confront the individuals — note the location and time and let officers respond.",
    source: "Crime Stoppers USA",
    sourceUrl: "https://www.crimestoppersusa.com/",
    group: "prevention",
    offenseSubstrings: ["drug", "narcotic"],
    categories: ["SOCIETY"],
  },
  {
    id: "general-awareness",
    title: "Trust your instincts",
    body:
      "Most safety advice comes down to this: notice when something feels off, leave situations that do not feel right, and never put property ahead of personal safety. When unsure, call your city's police non-emergency line.",
    source: "U.S. Department of Justice — Community Policing",
    sourceUrl: "https://cops.usdoj.gov/",
    group: "prevention",
  },
];

const SELF_DEFENSE_TIPS: SafetyTip[] = [
  {
    id: "self-defense-principles",
    title: "Principles of personal self-defense",
    body:
      "Self-defense begins with awareness, distance, and exit. Trained instructors recommend the layered approach: notice the situation, create distance, look for an exit, and use physical defense only as a last resort. Verbal de-escalation often prevents an attack.",
    source: "National Safety Council — Personal Safety",
    sourceUrl: "https://www.nsc.org/community-safety/safety-topics",
    group: "self-defense",
  },
  {
    id: "self-defense-classes",
    title: "Take a structured class in your city",
    body:
      "Real skill comes from practice, not videos. Many community recreation centers and police departments offer free or low-cost self-defense courses. Check your city's parks and recreation calendar, or your police department's community-programs page.",
    source: "U.S. Department of Justice — Office on Violence Against Women",
    sourceUrl: "https://www.justice.gov/ovw",
    group: "self-defense",
  },
  {
    id: "pepper-spray-ca",
    title: "Pepper spray is legal in California, with limits",
    body:
      "California permits adults (18+) without a violent-crime conviction to carry pepper spray. The container must hold no more than 2.5 ounces of active product. It is illegal to use pepper spray against any person except in lawful self-defense. Sale to minors and use against an officer carry separate penalties.",
    source: "California Penal Code §22810 and §22815",
    sourceUrl: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=PEN&sectionNum=22810.",
    group: "ca-legal",
  },
  {
    id: "stun-gun-ca",
    title: "Stun guns are legal for adults; some convictions disqualify",
    body:
      "California allows possession of a stun gun by adults without a felony or assault conviction. Carrying a stun gun in some restricted locations (e.g., schools, government buildings) is prohibited under separate statutes.",
    source: "California Penal Code §22610",
    sourceUrl: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=PEN&sectionNum=22610.",
    group: "ca-legal",
  },
  {
    id: "carrying-knives-ca",
    title: "Carrying knives in California: what is and is not allowed",
    body:
      "Folding knives that are not switchblades may generally be carried concealed. Fixed-blade or 'dirk and dagger' style knives must be carried openly in a sheath. Switchblades with a blade of 2 inches or more are prohibited in your possession in any public place. Local rules in some cities are stricter — verify with city ordinance.",
    source: "California Penal Code §§17235, 21310, 21510",
    sourceUrl: "https://leginfo.legislature.ca.gov/faces/codes_displayexpandedbranch.xhtml?tocCode=PEN",
    group: "ca-legal",
  },
  {
    id: "lawful-self-defense-ca",
    title: "When force is legally justified in California",
    body:
      "Under Penal Code §197 and case law, a person may use reasonable force in self-defense or in defense of another when they reasonably believe an imminent attack is about to cause bodily harm. Force must be proportionate to the threat and stops being lawful once the threat ends. Deadly force is justified only when a reasonable person would believe it necessary to prevent imminent death or great bodily injury.",
    source: "California Penal Code §197 + CALCRIM 505",
    sourceUrl: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=PEN&sectionNum=197.",
    group: "ca-legal",
  },
  {
    id: "castle-doctrine-ca",
    title: "Castle Doctrine: defending your home",
    body:
      "California Penal Code §198.5 creates a legal presumption that someone unlawfully and forcibly inside your residence poses an imminent threat of great bodily injury. That presumption permits the use of deadly force in defense of self or family inside the home. The doctrine applies to your residence — it does not extend to public places.",
    source: "California Penal Code §198.5",
    sourceUrl: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=PEN&sectionNum=198.5.",
    group: "ca-legal",
  },
  {
    id: "firearms-ca",
    title: "Firearms and concealed-carry in California",
    body:
      "Open carry of firearms is prohibited in incorporated cities. Concealed carry requires a CCW permit issued by the local sheriff or police chief; standards vary by jurisdiction and a 16-hour training course is the minimum. Carrying any firearm in a school zone, federal building, or other restricted location is a separate criminal offense.",
    source: "California Attorney General — Firearms",
    sourceUrl: "https://oag.ca.gov/firearms",
    group: "ca-legal",
  },
  {
    id: "documenting-incidents",
    title: "How to document an incident for police",
    body:
      "If you are a victim or witness: from a safe distance, note the time, location, description of vehicles and clothing, direction of travel, and any words spoken. Avoid focusing on facial features alone — vehicles and clothing are far more useful to investigators. Call 911 for emergencies; otherwise use the non-emergency line shown below.",
    source: "International Association of Chiefs of Police",
    sourceUrl: "https://www.theiacp.org/",
    group: "self-defense",
  },
];

const TIPS: SafetyTip[] = [...PREVENTION_TIPS, ...SELF_DEFENSE_TIPS];

export interface MatchedTip extends SafetyTip { relevance: number }

export interface SafetyTipsResponse {
  area: string;
  city: { slug: string; label: string };
  nonEmergency: { line: string; label: string; url: string };
  basedOn: { dominantCategory: string | null; topOffense?: string };
  prevention: MatchedTip[];
  selfDefense: MatchedTip[];
  caLegal: MatchedTip[];
  disclaimer: string;
}

const CA_CITIES = new Set<CitySlug>(["san-diego", "los-angeles", "san-francisco", "oakland"]);

/// Build one city-specific tip per request, pointing to that city's actual
/// police department crime-prevention page rather than the generic FBI
/// resource everyone else gets. We tailor the body to the area's dominant
/// crime mix so a Detroit user with property-heavy stats sees property-
/// focused phrasing and a Seattle user with society-heavy stats sees
/// transit-focused phrasing.
function buildCityResourceTip(citySlug: CitySlug, dominantCategory: "PERSONS" | "PROPERTY" | "SOCIETY" | null): MatchedTip {
  const res = CITY_RESOURCES[citySlug];
  const cityName = res.name.replace(/ Police Department$/, "").replace(/ Police$/, "").trim();
  let body = `For local guidance specific to ${cityName}, your police department publishes a crime-prevention resource page with neighborhood-watch sign-ups, community-meeting schedules, and tips matched to recent ${cityName} crime trends. Use this as your first stop before reading the generic federal material in the cards below.`;
  if (dominantCategory === "PROPERTY") {
    body = `Property crime drives most reports in your area right now. The ${res.name} crime-prevention resource page lists ${cityName}-specific guidance — securing vehicles, package-theft countermeasures, residential burglary checklists — that is more relevant than the generic federal material in the cards below.`;
  } else if (dominantCategory === "PERSONS") {
    body = `Violent incidents drive a meaningful share of reports in your area. The ${res.name} publishes ${cityName}-specific personal-safety guidance (transit-station awareness, de-escalation, what to do if confronted) along with neighborhood-watch and victim-services contacts that the generic federal cards below do not include.`;
  } else if (dominantCategory === "SOCIETY") {
    body = `"Society" offenses (drug, weapons, public-order) drive much of the recent reporting here. The ${res.name} publishes ${cityName}-specific guidance on reporting these incidents to the right channel — police non-emergency line for ongoing activity, 911 for active emergencies — rather than confronting anyone yourself.`;
  }
  return {
    id: `city-resource-${citySlug}`,
    title: `${cityName} police: official prevention resources`,
    body,
    source: res.programName ?? res.name,
    sourceUrl: res.programUrl ?? res.url,
    group: "prevention",
    relevance: 200, // pin to the top of prevention
  };
}

/// Pick tips matched to the area's actual top offenses + dominant category.
/// Prevention is AI-generated per-neighborhood (10 tips, grounded in real
/// reported offenses). Self-defense is curated. CA legal cites are only
/// returned for California cities. The non-emergency contact returned is the
/// one for the city the area belongs to.
export async function getSafetyTipsForArea(area: string): Promise<SafetyTipsResponse> {
  const city = cityForArea(area);
  const citySlug = city.slug as CitySlug;
  const mix = await getCrimeMix(area).catch(() => null);
  const offenses = (mix?.topOffenses ?? []).map((o) => ({ text: o.offense.toLowerCase(), cat: o.category }));
  const dominantCategory = (() => {
    const c = { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 };
    for (const o of mix?.topOffenses ?? []) c[o.category] += o.count;
    const sorted = (Object.entries(c) as Array<["PERSONS" | "PROPERTY" | "SOCIETY", number]>).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[1] ? sorted[0][0] : null;
  })();

  function scoreForCity(t: SafetyTip): number {
    let relevance = 0;
    if (t.cities && !t.cities.includes(citySlug)) return -1;
    if (t.categories && dominantCategory && t.categories.includes(dominantCategory)) relevance += 5;
    if (t.offenseSubstrings) {
      for (const sub of t.offenseSubstrings) {
        for (const o of offenses) if (o.text.includes(sub.toLowerCase())) relevance += 3;
      }
    }
    if (!t.categories && !t.offenseSubstrings) relevance += 1;
    return relevance;
  }

  function bucket(group: TipGroup, max: number): MatchedTip[] {
    return TIPS
      .filter((t) => t.group === group)
      .map((t) => ({ ...t, relevance: scoreForCity(t) }))
      .filter((t) => t.relevance >= 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, max);
  }

  // Per-neighborhood AI-generated prevention tips. The AI is grounded in the
  // area's actual top offenses; if generation fails (no API key, parse error,
  // empty mix) we fall back to the curated prevention set so users always see
  // something.
  const aiPrevention = await generateAITipsForArea(area);
  const aiAsMatched: MatchedTip[] = aiPrevention
    .filter((t) => t.group !== "self-defense")
    .map((t, i) => ({
      id: t.id,
      title: t.title,
      body: t.body,
      source: t.source,
      sourceUrl: t.sourceUrl,
      group: "prevention",
      relevance: 100 - i, // preserve AI's ordering
    }));
  const aiSelfDefense: MatchedTip[] = aiPrevention
    .filter((t) => t.group === "self-defense")
    .map((t, i) => ({
      id: t.id,
      title: t.title,
      body: t.body,
      source: t.source,
      sourceUrl: t.sourceUrl,
      group: "self-defense",
      relevance: 100 - i,
    }));

  // Threshold lowered from 6 → 3 because the AI sometimes returns fewer
  // prevention-tagged tips when many are mapped to self-defense or civic.
  // Combining 3+ AI tips with curated fillers is still strictly better than
  // showing only the 8 generic curated tips.
  // Always inject one city-specific tip at the top of prevention so users see
  // guidance naming THEIR police department (not the generic FBI fallback).
  const cityResourceTip = buildCityResourceTip(citySlug, dominantCategory);
  const aiOrCurated = aiAsMatched.length >= 3
    ? [...aiAsMatched, ...bucket("prevention", Math.max(0, 10 - aiAsMatched.length))]
    : bucket("prevention", 8);
  const prevention = [cityResourceTip, ...aiOrCurated].slice(0, 10);
  const selfDefense = aiSelfDefense.length > 0
    ? [...aiSelfDefense, ...bucket("self-defense", 2)].slice(0, 4)
    : bucket("self-defense", 4);
  const caLegal = CA_CITIES.has(citySlug) ? bucket("ca-legal", 6) : [];

  const sourceParts: string[] = [
    "official agencies (city police departments, FBI, U.S. Postal Inspection Service, Ready.gov)",
  ];
  if (CA_CITIES.has(citySlug)) sourceParts.push("California statute (Penal Code) and the California Attorney General");
  if (aiPrevention.length > 0) sourceParts.push("AI-tailored prevention guidance grounded in this area's most-reported offenses");

  // Hard guarantee: every registered city now has an entry in NON_EMERGENCY,
  // so this lookup never falls back. The `?? san-diego` was masking missing
  // entries — the user saw SDPD's number on Baton Rouge, Cambridge, Dallas,
  // Charlotte, Nashville, and Minneapolis because the type cast above is
  // unsafe and the runtime lookup silently failed.
  const nonEmergency = NON_EMERGENCY[citySlug];
  if (!nonEmergency) {
    console.warn(`[safety.tips] NON_EMERGENCY missing entry for city slug: ${citySlug}`);
  }
  return {
    area,
    city: { slug: city.slug, label: city.label },
    nonEmergency: nonEmergency ?? NON_EMERGENCY["san-diego"],
    basedOn: { dominantCategory, topOffense: mix?.topOffenses[0]?.offense },
    prevention,
    selfDefense,
    caLegal,
    disclaimer:
      `Information sourced from ${sourceParts.join("; ")}. ` +
      "The application provides general best practices and is not legal advice. Laws change; verify with the current statute or a licensed attorney before relying on this material in any specific situation.",
  };
}

export { type AITip };
