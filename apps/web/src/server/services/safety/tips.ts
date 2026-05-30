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
  | "san-diego" | "los-angeles" | "san-francisco" | "oakland" | "sacramento"
  | "chicago" | "seattle" | "new-york" | "colorado-springs" | "detroit"
  | "washington-dc" | "boston" | "philadelphia" | "cincinnati"
  | "new-orleans" | "baton-rouge" | "cambridge" | "dallas"
  | "charlotte" | "nashville" | "minneapolis" | "cleveland"
  | "milwaukee" | "las-vegas" | "boise" | "buffalo" | "tucson"
  | "kansas-city" | "saint-paul" | "pittsburgh"
  // v98c — these 8 were absent from the union, so Record<CitySlug,…>
  // lookups (CITY_RESOURCES, NON_EMERGENCY) silently missed them and the
  // safety tab 500'd for these cities.
  | "norfolk" | "phoenix" | "denver" | "atlanta" | "indianapolis" | "raleigh" | "honolulu";
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
// Exported so the Neighborhood Watch service can reach the same verified
// non-emergency lines without duplicating them.
export const NON_EMERGENCY: Record<CitySlug, { line: string; label: string; url: string }> = {
  "san-diego":     { line: "619-531-2000", label: "SDPD non-emergency",   url: "https://www.sandiego.gov/police" },
  "los-angeles":   { line: "877-275-5273", label: "LAPD non-emergency",   url: "https://www.lapdonline.org/" },
  "san-francisco": { line: "415-553-0123", label: "SFPD non-emergency",   url: "https://www.sf.gov/departments/police-department" },
  "oakland":       { line: "510-777-3333", label: "OPD non-emergency",    url: "https://www.oaklandca.gov/departments/police-department" },
  "chicago":       { line: "311",          label: "Chicago Police via 311", url: "https://www.chicago.gov/city/en/depts/cpd.html" },
  "seattle":       { line: "206-625-5011", label: "SPD non-emergency",    url: "https://www.seattle.gov/police" },
  "new-york":      { line: "311",          label: "NYPD via NYC 311",     url: "https://www.nyc.gov/site/nypd/index.page" },
  "colorado-springs": { line: "719-444-7000", label: "CSPD non-emergency",   url: "https://coloradosprings.gov/police-department" },
  "detroit":       { line: "313-267-4600", label: "DPD non-emergency",    url: "https://detroitmi.gov/departments/police-department" },
  "washington-dc": { line: "311",          label: "MPD via DC 311",       url: "https://mpdc.dc.gov/" },
  "boston":        { line: "617-343-4240", label: "BPD non-emergency",    url: "https://www.boston.gov/departments/police" },
  "philadelphia":  { line: "311",          label: "PPD via Philly 311",   url: "https://www.phila.gov/departments/philadelphia-police-department/" },
  "cincinnati":    { line: "513-765-1212", label: "CPD non-emergency",    url: "https://www.cincinnati-oh.gov/police/" },
  "new-orleans":   { line: "504-821-2222", label: "NOPD non-emergency",   url: "https://nola.gov/next/nopd/home/" },
  "baton-rouge":   { line: "225-389-2000", label: "BRPD non-emergency",   url: "https://www.brla.gov/" },
  "cambridge":     { line: "617-349-3300", label: "Cambridge PD non-emergency", url: "https://www.cambridgema.gov/Departments/CambridgePolice" },
  "dallas":        { line: "214-744-4444", label: "DPD non-emergency",    url: "https://www.dallaspolice.net/" },
  "charlotte":     { line: "704-336-7600", label: "CMPD non-emergency",   url: "https://charlottenc.gov/CMPD" },
  "nashville":     { line: "615-862-8600", label: "MNPD non-emergency",   url: "https://www.nashville.gov/departments/police" },
  "minneapolis":   { line: "612-348-2345", label: "MPD non-emergency",    url: "https://www.minneapolismn.gov/police/" },
  "cleveland":     { line: "216-621-1234", label: "CDP non-emergency",    url: "https://www.clevelandpolice.org/" },
  "milwaukee":     { line: "414-933-4444", label: "MPD non-emergency",     url: "https://city.milwaukee.gov/police" },
  "las-vegas":     { line: "702-828-3111", label: "LVMPD non-emergency",  url: "https://www.lvmpd.com/" },
  "boise":         { line: "208-377-6790", label: "BPD non-emergency",    url: "https://www.cityofboise.org/departments/police/" },
  "buffalo":       { line: "716-851-4444", label: "Buffalo PD non-emergency", url: "https://www.buffalony.gov/" },
  "tucson":        { line: "520-791-4444", label: "TPD non-emergency",    url: "https://www.tucsonaz.gov/Departments/Police" },
  "kansas-city":   { line: "816-234-5111", label: "KCPD non-emergency",   url: "https://kcpolice.org/" },
  "saint-paul":    { line: "651-291-1111", label: "SPPD non-emergency",   url: "https://www.stpaul.gov/departments/police" },
  "pittsburgh":    { line: "412-255-2828", label: "PBP non-emergency",    url: "https://pittsburghpa.gov/publicsafety/police" },
  // v98c — the 8 cities that previously fell back to SDPD's number.
  "sacramento":    { line: "916-808-5471", label: "Sacramento PD non-emergency", url: "https://www.cityofsacramento.gov/police" },
  "norfolk":       { line: "757-441-5610", label: "Norfolk PD non-emergency", url: "https://www.norfolk.gov/356/Police" },
  "phoenix":       { line: "602-262-6151", label: "Phoenix PD Crime Stop (non-emergency)", url: "https://www.phoenix.gov/police" },
  "denver":        { line: "720-913-2000", label: "Denver PD non-emergency", url: "https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Police-Department" },
  "atlanta":       { line: "404-658-6666", label: "Atlanta E911 non-emergency", url: "https://www.atlantapd.org/" },
  "indianapolis":  { line: "317-327-3811", label: "IMPD non-emergency", url: "https://www.indy.gov/agency/indianapolis-metropolitan-police-department" },
  "raleigh":       { line: "919-829-1911", label: "Raleigh PD non-emergency", url: "https://raleighnc.gov/police" },
  "honolulu":      { line: "808-529-3111", label: "HPD non-emergency", url: "https://www.honolulupd.org/" },
};

// City-specific official resource links. These get joined into one or more
// prevention tips per city so users see guidance that names their own police
// department and links to their city's actual crime-prevention / community
// resources page — not the generic FBI page that every city otherwise gets.
// Exported so the Neighborhood Watch service can reuse the same verified
// per-city police-department resource links.
export const CITY_RESOURCES: Record<CitySlug, { name: string; url: string; programName?: string; programUrl?: string }> = {
  "san-diego":     { name: "San Diego Police Department",    url: "https://www.sandiego.gov/police",         programName: "SDPD Crime Prevention",          programUrl: "https://www.sandiego.gov/police/services/prevention" },
  "los-angeles":   { name: "Los Angeles Police Department",  url: "https://www.lapdonline.org/",             programName: "LAPD Crime Prevention",          programUrl: "https://www.lapdonline.org/crime-prevention/" },
  "san-francisco": { name: "San Francisco Police Department", url: "https://www.sf.gov/departments/police-department", programName: "San Francisco Police Department", programUrl: "https://www.sf.gov/departments/police-department" },
  "oakland":       { name: "Oakland Police Department",      url: "https://www.oaklandca.gov/departments/police-department", programName: "OPD Crime Prevention", programUrl: "https://www.oaklandca.gov/topics/crime-prevention" },
  "chicago":       { name: "Chicago Police Department",      url: "https://www.chicago.gov/city/en/depts/cpd.html", programName: "CPD CAPS (Chicago Alternative Policing Strategy)", programUrl: "https://home.chicagopolice.org/community/caps/" },
  "seattle":       { name: "Seattle Police Department",      url: "https://www.seattle.gov/police",          programName: "SPD Crime Prevention",           programUrl: "https://www.seattle.gov/police/crime-prevention" },
  "new-york":      { name: "New York City Police Department", url: "https://www.nyc.gov/site/nypd/index.page", programName: "New York City Police Department", programUrl: "https://www.nyc.gov/site/nypd/index.page" },
  "colorado-springs": { name: "Colorado Springs Police Department", url: "https://coloradosprings.gov/police-department", programName: "CSPD Crime Prevention", programUrl: "https://coloradosprings.gov/police-department/page/crime-prevention" },
  "detroit":       { name: "Detroit Police Department",      url: "https://detroitmi.gov/departments/police-department", programName: "DPD Project Green Light", programUrl: "https://detroitmi.gov/departments/police-department/project-green-light-detroit" },
  "washington-dc": { name: "DC Metropolitan Police Department", url: "https://mpdc.dc.gov/",                  programName: "MPDC Crime Prevention",          programUrl: "https://mpdc.dc.gov/page/crime-prevention" },
  "boston":        { name: "Boston Police Department",       url: "https://www.boston.gov/departments/police", programName: "Boston Police Department",     programUrl: "https://www.boston.gov/departments/police" },
  "philadelphia":  { name: "Philadelphia Police Department", url: "https://www.phila.gov/departments/philadelphia-police-department/", programName: "Philadelphia Police Department", programUrl: "https://www.phila.gov/departments/philadelphia-police-department/" },
  "cincinnati":    { name: "Cincinnati Police Department",   url: "https://www.cincinnati-oh.gov/police/",   programName: "Cincinnati Police Department",   programUrl: "https://www.cincinnati-oh.gov/police/" },
  "new-orleans":   { name: "New Orleans Police Department",  url: "https://nola.gov/next/nopd/home/",        programName: "New Orleans Police Department",  programUrl: "https://nola.gov/next/nopd/home/" },
  "baton-rouge":   { name: "Baton Rouge Police Department",  url: "https://www.brla.gov/", programName: "Baton Rouge Police Department", programUrl: "https://www.brla.gov/" },
  "cambridge":     { name: "Cambridge Police Department",    url: "https://www.cambridgema.gov/Departments/CambridgePolice", programName: "Cambridge Police Department", programUrl: "https://www.cambridgema.gov/Departments/CambridgePolice" },
  "dallas":        { name: "Dallas Police Department",       url: "https://www.dallaspolice.net/",           programName: "Dallas Police Department",       programUrl: "https://www.dallaspolice.net/" },
  "charlotte":     { name: "Charlotte-Mecklenburg Police",   url: "https://charlottenc.gov/CMPD",            programName: "CMPD Crime Prevention",          programUrl: "https://charlottenc.gov/CMPD/Pages/CommunityRelations/CrimePrevention.aspx" },
  "nashville":     { name: "Metro Nashville Police Department", url: "https://www.nashville.gov/departments/police", programName: "Metro Nashville Police Department", programUrl: "https://www.nashville.gov/departments/police" },
  "minneapolis":   { name: "Minneapolis Police Department",  url: "https://www.minneapolismn.gov/police/", programName: "Minneapolis Police Department", programUrl: "https://www.minneapolismn.gov/resident-services/public-safety/police-public-safety/" },
  "cleveland":     { name: "Cleveland Division of Police",   url: "https://www.clevelandpolice.org/", programName: "CDP Community Policing", programUrl: "https://www.clevelandpolice.org/about/community" },
  "milwaukee":     { name: "Milwaukee Police Department", url: "https://city.milwaukee.gov/police", programName: "MPD Community Engagement", programUrl: "https://city.milwaukee.gov/police/Community" },
  "las-vegas":     { name: "Las Vegas Metropolitan Police Department", url: "https://www.lvmpd.com/", programName: "LVMPD Community Engagement", programUrl: "https://www.lvmpd.com/en-us/Pages/Community-Engagement.aspx" },
  "boise":         { name: "Boise Police Department", url: "https://www.cityofboise.org/departments/police/", programName: "Boise Police Department", programUrl: "https://www.cityofboise.org/departments/police/" },
  "buffalo":       { name: "Buffalo Police Department", url: "https://www.buffalony.gov/", programName: "Buffalo Police Department", programUrl: "https://www.buffalony.gov/" },
  "tucson":        { name: "Tucson Police Department", url: "https://www.tucsonaz.gov/Departments/Police", programName: "TPD Crime Prevention", programUrl: "https://www.tucsonaz.gov/Departments/Police/Crime-Prevention" },
  "kansas-city":   { name: "Kansas City Missouri Police Department", url: "https://kcpolice.org/", programName: "KCPD Community Outreach", programUrl: "https://kcpolice.org/community/" },
  "saint-paul":    { name: "Saint Paul Police Department", url: "https://www.stpaul.gov/departments/police", programName: "Saint Paul Police Department", programUrl: "https://www.stpaul.gov/departments/police" },
  "pittsburgh":    { name: "Pittsburgh Bureau of Police", url: "https://pittsburghpa.gov/publicsafety/police", programName: "Pittsburgh Bureau of Police", programUrl: "https://pittsburghpa.gov/publicsafety/police" },
  // v98c — these 8 were missing, which crashed the safety tab (500) for
  // their cities. Main department sites (stable); programUrl points to the
  // same site to avoid linking a guessed sub-page.
  "norfolk":       { name: "Norfolk Police Department", url: "https://www.norfolk.gov/356/Police", programName: "Norfolk Police Department", programUrl: "https://www.norfolk.gov/356/Police" },
  "phoenix":       { name: "Phoenix Police Department", url: "https://www.phoenix.gov/police", programName: "Phoenix Police Department", programUrl: "https://www.phoenix.gov/police" },
  "denver":        { name: "Denver Police Department", url: "https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Police-Department", programName: "Denver Police Department", programUrl: "https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Police-Department" },
  "sacramento":    { name: "Sacramento Police Department", url: "https://www.cityofsacramento.gov/police", programName: "Sacramento Police Department", programUrl: "https://www.cityofsacramento.gov/police" },
  "atlanta":       { name: "Atlanta Police Department", url: "https://www.atlantapd.org/", programName: "APD Crime Prevention", programUrl: "https://www.atlantapd.org/i-want-to/crime-prevention" },
  "indianapolis":  { name: "Indianapolis Metropolitan Police Department", url: "https://www.indy.gov/agency/indianapolis-metropolitan-police-department", programName: "IMPD", programUrl: "https://www.indy.gov/agency/indianapolis-metropolitan-police-department" },
  "raleigh":       { name: "Raleigh Police Department", url: "https://raleighnc.gov/police", programName: "Raleigh Police Department", programUrl: "https://raleighnc.gov/police" },
  "honolulu":      { name: "Honolulu Police Department", url: "https://www.honolulupd.org/", programName: "HPD Crime Prevention", programUrl: "https://www.honolulupd.org/information/crime-prevention/" },
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
    sourceUrl: "https://www.ncpc.org/",
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

// v98b — universal self-defense-LAW principles that hold across every U.S.
// jurisdiction. Shown to every non-California city, LED by a state-specific
// "duty to retreat vs stand your ground" card (buildStatePostureCard below)
// so the section is genuinely tailored to the user's state. The 4 CA cities
// keep their detailed CA Penal-Code cards. Framed as general information;
// the response disclaimer reinforces "verify your state's statute / consult
// an attorney."
const UNIVERSAL_LEGAL_TIPS: SafetyTip[] = [
  {
    id: "legal-when-justified",
    title: "When self-defense is legally justified",
    body:
      "Across U.S. states, self-defense generally requires a reasonable belief that you face an imminent, unlawful threat of harm, and the force you use must be proportional to that threat. The justification ends the moment the threat ends — force used after an attacker has stopped or fled is no longer lawful self-defense. Verify the exact standard in your state's statute.",
    source: "Cornell Legal Information Institute — Self-Defense",
    sourceUrl: "https://www.law.cornell.edu/wex/self-defense",
    group: "ca-legal",
  },
  {
    id: "legal-deadly-force",
    title: "Deadly force is the narrowest exception",
    body:
      "Nearly every state limits deadly force to situations where a reasonable person would believe it necessary to prevent imminent death or great bodily injury (and, in some states, specific felonies like a forcible home invasion). It is never lawful to use deadly force to protect property alone or to pursue or punish someone. When in doubt, the lawful and safer choice is to escape and call 911.",
    source: "Cornell Legal Information Institute — Deadly Force",
    sourceUrl: "https://www.law.cornell.edu/wex/deadly_force",
    group: "ca-legal",
  },
  {
    id: "legal-less-lethal",
    title: "Less-lethal tools are legal — but regulated by state",
    body:
      "Pepper spray is legal for self-defense in all 50 states, though states cap canister size and bar sale to minors or people with certain convictions. Stun guns, batons, and knives are allowed in many states but restricted or banned in others, and carry rules differ for firearms. Check your state's and city's specific limits before buying or carrying any defensive tool.",
    source: "FindLaw — Self-Defense Weapons & State Law",
    sourceUrl: "https://www.findlaw.com/criminal/criminal-law-basics/self-defense-law.html",
    group: "ca-legal",
  },
  {
    id: "legal-aftermath",
    title: "After using force: report and get counsel",
    body:
      "If you ever use force, call 911 yourself, report what happened factually, and be prepared to explain why you believed you were in imminent danger — you may have to justify your actions even if they were lawful. Do not tamper with the scene, and consider speaking with a licensed attorney before giving a detailed statement. Reporting first also protects you if the other person calls first.",
    source: "American Bar Association — Public Resources",
    sourceUrl: "https://www.americanbar.org/groups/public_education/resources/",
    group: "ca-legal",
  },
];

// v98b — city -> US state, for state-tailored self-defense law. The four
// (now five, incl. Sacramento) CA cities use the detailed CA Penal-Code
// cards; every other city is led by a card for its OWN state's posture.
const CITY_STATE: Record<string, string> = {
  "san-diego": "CA", "los-angeles": "CA", "san-francisco": "CA", "oakland": "CA", "sacramento": "CA",
  "chicago": "IL", "seattle": "WA", "new-york": "NY", "buffalo": "NY",
  "colorado-springs": "CO", "denver": "CO", "detroit": "MI", "washington-dc": "DC",
  "boston": "MA", "cambridge": "MA", "philadelphia": "PA", "pittsburgh": "PA",
  "cincinnati": "OH", "cleveland": "OH", "new-orleans": "LA", "baton-rouge": "LA",
  "dallas": "TX", "charlotte": "NC", "raleigh": "NC", "nashville": "TN",
  "minneapolis": "MN", "saint-paul": "MN", "milwaukee": "WI", "las-vegas": "NV",
  "boise": "ID", "norfolk": "VA", "kansas-city": "MO", "phoenix": "AZ", "tucson": "AZ",
  "atlanta": "GA", "indianapolis": "IN", "honolulu": "HI",
};

// Verified against NCSL's state-by-state self-defense table + each state's
// statute. `syg` = no general duty to retreat in public (stand your ground);
// !syg = duty to retreat in public where safe. Every state below also
// recognizes a castle doctrine inside the home. `basis` notes whether the
// posture is statutory or established by case law; `cite` is the controlling
// statute (or "case law" where the posture is judicial).
interface StateLaw { name: string; syg: boolean; basis: string; cite: string }
const STATE_LAW: Record<string, StateLaw> = {
  IL: { name: "Illinois",   syg: true,  basis: "case law",                                                  cite: "720 ILCS 5/7-1" },
  WA: { name: "Washington", syg: true,  basis: "case law",                                                  cite: "RCW 9A.16.020 + case law" },
  NY: { name: "New York",   syg: false, basis: "statute",                                                   cite: "N.Y. Penal Law §35.15" },
  CO: { name: "Colorado",   syg: true,  basis: "case law, plus the 'Make My Day' home-defense statute",     cite: "C.R.S. §18-1-704 / §18-1-704.5" },
  MI: { name: "Michigan",   syg: true,  basis: "statute",                                                   cite: "MCL §780.972" },
  DC: { name: "the District of Columbia", syg: false, basis: "case law",                                    cite: "D.C. self-defense case law" },
  MA: { name: "Massachusetts", syg: false, basis: "case law (castle doctrine by statute)",                  cite: "M.G.L. c.278 §8A" },
  PA: { name: "Pennsylvania", syg: true, basis: "statute, with conditions (you must lawfully be present and the attacker must display or use a weapon)", cite: "18 Pa.C.S. §505" },
  OH: { name: "Ohio",       syg: true,  basis: "statute (2021)",                                            cite: "R.C. §2901.09" },
  LA: { name: "Louisiana",  syg: true,  basis: "statute",                                                   cite: "La. R.S. 14:20" },
  TX: { name: "Texas",      syg: true,  basis: "statute",                                                   cite: "Tex. Penal Code §9.31 / §9.32" },
  NC: { name: "North Carolina", syg: true, basis: "statute",                                                cite: "N.C.G.S. §14-51.3" },
  TN: { name: "Tennessee",  syg: true,  basis: "statute",                                                   cite: "Tenn. Code §39-11-611" },
  MN: { name: "Minnesota",  syg: false, basis: "case law",                                                  cite: "Minn. Stat. §609.06 / §609.065" },
  WI: { name: "Wisconsin",  syg: true,  basis: "statute (no duty to retreat, though a jury may still weigh whether retreat was feasible)", cite: "Wis. Stat. §939.48" },
  NV: { name: "Nevada",     syg: true,  basis: "statute",                                                   cite: "NRS §200.120" },
  ID: { name: "Idaho",      syg: true,  basis: "statute",                                                   cite: "Idaho Code §19-202A" },
  VA: { name: "Virginia",   syg: true,  basis: "case law (for a person who is not at fault)",               cite: "Virginia self-defense case law" },
  MO: { name: "Missouri",   syg: true,  basis: "statute",                                                   cite: "Mo. Rev. Stat. §563.031" },
  AZ: { name: "Arizona",    syg: true,  basis: "statute",                                                   cite: "A.R.S. §13-405" },
  GA: { name: "Georgia",    syg: true,  basis: "statute",                                                   cite: "O.C.G.A. §16-3-23.1" },
  IN: { name: "Indiana",    syg: true,  basis: "statute",                                                   cite: "Ind. Code §35-41-3-2" },
  HI: { name: "Hawaii",     syg: false, basis: "statute",                                                   cite: "H.R.S. §703-304" },
};

/// Build the lead legal card for a non-CA city: a plain-language summary of
/// that state's duty-to-retreat / stand-your-ground posture + castle
/// doctrine, with the controlling statute and the NCSL table for the user to
/// verify. Returns null for CA (handled by the detailed CA cards) or any
/// unmapped state.
function buildStatePostureCard(citySlug: CitySlug): SafetyTip | null {
  const law = STATE_LAW[CITY_STATE[citySlug] ?? ""];
  if (!law) return null;
  const body = law.syg
    ? `${law.name} is a "stand your ground" jurisdiction (${law.basis}): you generally have no legal duty to retreat before using lawful, proportional force in a place you have a right to be. ${law.name} also recognizes the "castle doctrine," which removes any retreat requirement inside your own home. Force must still be reasonable, proportional to the threat, and stop the moment the threat ends. Verify the current rule (${law.cite}) before relying on it.`
    : `${law.name} is a "duty to retreat" jurisdiction (${law.basis}): in public you generally must retreat first if you can do so with complete safety, before using force. ${law.name} still recognizes the "castle doctrine," which removes any retreat requirement inside your own home. Force must be reasonable and proportional to the threat. Verify the current rule (${law.cite}) before relying on it.`;
  return {
    id: "legal-state-posture",
    title: law.syg ? `${law.name}: stand your ground + castle doctrine` : `${law.name}: duty to retreat + castle doctrine`,
    body,
    source: `${law.name} self-defense law (${law.cite}) · NCSL`,
    sourceUrl: "https://www.ncsl.org/civil-and-criminal-justice/self-defense-and-stand-your-ground",
    group: "ca-legal",
  };
}

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

/// Build one city-specific tip per request, pointing to that city's actual
/// police department crime-prevention page rather than the generic FBI
/// resource everyone else gets. We tailor the body to the area's dominant
/// crime mix so a Detroit user with property-heavy stats sees property-
/// focused phrasing and a Seattle user with society-heavy stats sees
/// transit-focused phrasing.
function buildCityResourceTip(citySlug: CitySlug, dominantCategory: "PERSONS" | "PROPERTY" | "SOCIETY" | null): MatchedTip {
  const res = CITY_RESOURCES[citySlug];
  // v98c — CRITICAL guard. A city missing from CITY_RESOURCES previously
  // crashed here (`res.name` on undefined → 500 for the ENTIRE safety tab,
  // including the per-state legal section). Eight cities were missing
  // (norfolk, phoenix, denver, sacramento, atlanta, indianapolis, raleigh,
  // honolulu) — those are now added below, but this fallback guarantees no
  // future omission can break the tab again.
  if (!res) {
    return {
      id: `city-resource-${citySlug}`,
      title: "Official crime-prevention resources",
      body: "Your local police department and the FBI publish crime-prevention guidance — neighborhood-watch programs, the right reporting channels, and tips matched to recent local trends. Use these as your first stop before the general material in the cards below.",
      source: "FBI — Safety Resources",
      sourceUrl: "https://www.fbi.gov/how-we-can-help-you/safety-resources",
      group: "prevention",
      relevance: 200,
    };
  }
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
  // v98b — CA cities (incl. Sacramento, via the state map — CA_CITIES had
  // omitted it) get the detailed CA Penal-Code cards; every other city gets a
  // card for ITS OWN state's duty-to-retreat/stand-your-ground posture +
  // castle doctrine, followed by the universal principles.
  const isCA = CITY_STATE[citySlug] === "CA";
  const caLegal = isCA
    ? bucket("ca-legal", 6)
    : ([buildStatePostureCard(citySlug), ...UNIVERSAL_LEGAL_TIPS]
        .filter((t): t is SafetyTip => t != null)
        .map((t, i) => ({ ...t, relevance: 100 - i })));

  const sourceParts: string[] = [
    "official agencies (city police departments, FBI, U.S. Postal Inspection Service, Ready.gov)",
  ];
  if (isCA) sourceParts.push("California statute (Penal Code) and the California Attorney General");
  else {
    const stateName = STATE_LAW[CITY_STATE[citySlug] ?? ""]?.name;
    sourceParts.push(stateName
      ? `${stateName} self-defense law (NCSL state-by-state table) plus general U.S. principles (Cornell LII, ABA)`
      : "general U.S. self-defense law (Cornell LII, NCSL state-by-state, ABA)");
  }
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
