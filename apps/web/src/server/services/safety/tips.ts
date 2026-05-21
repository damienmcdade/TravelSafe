import "server-only";
import { getCrimeMix } from "../crime-data/mix";

// Curated, attributed safety tips indexed by NIBRS offense type. Sources are
// official: SDPD, FBI, NHTSA, NCMEC, Ready.gov. We quote the gist and link
// back. To add a tip: append to TIPS and key by an SDPD ibr_offense_description
// fragment (case-insensitive substring match) and/or a top-level NIBRS category.

export interface SafetyTip {
  id: string;
  title: string;
  body: string;
  source: string;
  sourceUrl: string;
  // Match conditions (any-of):
  offenseSubstrings?: string[];          // e.g. ["vehicle", "burglary"]
  categories?: Array<"PERSONS" | "PROPERTY" | "SOCIETY">;
}

const TIPS: SafetyTip[] = [
  {
    id: "vehicle-burglary",
    title: "Park smart, leave nothing visible",
    body:
      "Most vehicle break-ins are crimes of opportunity. Move bags, charging cables, and even loose coins out of sight before you leave the car. Park under streetlights when possible and lock all doors even for a quick stop.",
    source: "San Diego Police Department — Safety Tips",
    sourceUrl: "https://www.sandiego.gov/police/services/prevention",
    offenseSubstrings: ["vehicle", "from auto", "auto theft", "motor vehicle"],
  },
  {
    id: "residential-burglary",
    title: "Make your home look lived-in",
    body:
      "Burglars target homes that look empty. Use timers on interior lights, keep entry-points well lit, trim shrubs that hide windows, and tell a trusted neighbor when you'll be away.",
    source: "FBI — Burglary Prevention",
    sourceUrl: "https://www.fbi.gov/how-we-can-help-you/safety-resources",
    offenseSubstrings: ["burglary", "residential burglary"],
  },
  {
    id: "package-theft",
    title: "Beat porch pirates",
    body:
      "Schedule deliveries when you'll be home, require signature on expensive items, use a locking parcel box or a neighbor's address, and report thefts to both the carrier and SDPD non-emergency (619-531-2000).",
    source: "U.S. Postal Inspection Service",
    sourceUrl: "https://www.uspis.gov/news/scam-article/package-theft",
    offenseSubstrings: ["theft", "larceny"],
  },
  {
    id: "vandalism",
    title: "Document, photograph, report",
    body:
      "If you find graffiti or damage on your property: photograph it before cleanup, file an SDPD report (online or non-emergency line), and submit a 311 request so the city can prioritize area maintenance.",
    source: "City of San Diego — Get It Done",
    sourceUrl: "https://www.sandiego.gov/get-it-done",
    offenseSubstrings: ["vandalism", "destruction", "damage"],
  },
  {
    id: "assault-awareness",
    title: "Stay aware in transition zones",
    body:
      "Most assaults happen at transit stops, parking structures, and ATMs late at night. Travel with someone when possible, keep phones pocketed at street crossings, and trust your gut — leave a situation that feels off.",
    source: "National Crime Prevention Council",
    sourceUrl: "https://www.ncpc.org/resources/personal-safety/",
    offenseSubstrings: ["assault", "battery", "robbery", "intimidation"],
    categories: ["PERSONS"],
  },
  {
    id: "robbery",
    title: "If confronted: comply, then call 911",
    body:
      "Property is replaceable. If someone demands cash, your phone, or your bag — give it up calmly, get to a safe distance, and call 911. Try to remember the suspect's direction of travel, not their face.",
    source: "FBI — Stay Safe",
    sourceUrl: "https://www.fbi.gov/how-we-can-help-you/safety-resources",
    offenseSubstrings: ["robbery"],
    categories: ["PERSONS"],
  },
  {
    id: "drug-activity",
    title: "Report drug activity to the right channel",
    body:
      "Sustained dealing or use in a public place can be reported to SDPD's non-emergency line (619-531-2000) or anonymously via Crime Stoppers. Don't confront — note the location and time and let officers respond.",
    source: "San Diego Crime Stoppers",
    sourceUrl: "https://www.sdcrimestoppers.org/",
    offenseSubstrings: ["drug", "narcotic"],
    categories: ["SOCIETY"],
  },
  {
    id: "disorderly-conduct",
    title: "De-escalate, document, disengage",
    body:
      "If you witness a confrontation: keep distance, don't film someone's face directly (it can escalate), call 911 if anyone's safety is at risk, and let trained responders handle it.",
    source: "Ready.gov — Active Threats",
    sourceUrl: "https://www.ready.gov/active-shooter",
    offenseSubstrings: ["disorderly", "disturbing"],
    categories: ["SOCIETY"],
  },
  {
    id: "fire-safety-general",
    title: "Know your evacuation routes",
    body:
      "San Diego County has wildfire-prone zones. Sign up for SD Emergency Alerts, keep a go-bag with documents + medications, and know two ways out of your neighborhood by car AND on foot.",
    source: "SDG&E + County of San Diego Emergency Services",
    sourceUrl: "https://www.readysandiego.org/",
  },
  {
    id: "general-awareness",
    title: "Trust your instincts",
    body:
      "Most safety advice boils down to this: notice what feels off, leave situations that don't feel right, and never put property over your life. SDPD's non-emergency line for non-urgent reports: 619-531-2000.",
    source: "San Diego Police Department",
    sourceUrl: "https://www.sandiego.gov/police",
  },
];

export interface MatchedTip extends SafetyTip { relevance: number }

export interface SafetyTipsResponse {
  area: string;
  basedOn: { dominantCategory: string | null; topOffense?: string };
  tips: MatchedTip[];
  disclaimer: string;
}

/// Pick tips that match the area's actual top offenses + dominant category.
/// Falls back to general tips when there's no data. Always returns >=2 tips
/// so the panel never sits empty.
export async function getSafetyTipsForArea(area: string): Promise<SafetyTipsResponse> {
  const mix = await getCrimeMix(area, 30, 20).catch(() => null);
  const offenses = (mix?.topOffenses ?? []).map((o) => ({ text: o.offense.toLowerCase(), cat: o.category }));
  const dominantCategory = (() => {
    const c = { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 };
    for (const o of mix?.topOffenses ?? []) c[o.category] += o.count;
    const sorted = (Object.entries(c) as Array<["PERSONS" | "PROPERTY" | "SOCIETY", number]>).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[1] ? sorted[0][0] : null;
  })();

  const scored: MatchedTip[] = TIPS.map((tip) => {
    let relevance = 0;
    if (tip.categories && dominantCategory && tip.categories.includes(dominantCategory)) relevance += 5;
    if (tip.offenseSubstrings) {
      for (const sub of tip.offenseSubstrings) {
        for (const o of offenses) {
          if (o.text.includes(sub.toLowerCase())) relevance += 3;
        }
      }
    }
    // Always-applicable tips get a small baseline.
    if (!tip.categories && !tip.offenseSubstrings) relevance += 1;
    return { ...tip, relevance };
  })
    .filter((t) => t.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 6);

  // Always have at least 2 tips so the panel renders something useful.
  if (scored.length < 2) {
    const generic = TIPS.filter((t) => !t.categories && !t.offenseSubstrings).map((t) => ({ ...t, relevance: 1 }));
    scored.push(...generic);
  }

  return {
    area,
    basedOn: { dominantCategory, topOffense: mix?.topOffenses[0]?.offense },
    tips: scored.slice(0, 6),
    disclaimer: "Curated from official safety guidance (SDPD, FBI, Ready.gov, Crime Stoppers). These are general best practices, not legal advice.",
  };
}
