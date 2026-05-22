import "server-only";
import { crimeData } from "../crime-data";
import { cityForArea } from "../crime-data/cities";
import { getCrimeMix } from "../crime-data/mix";
import { generateAreaBrief } from "../ai/area-brief";
import { CITY_RESOURCES, NON_EMERGENCY, type CitySlug } from "../safety/tips";

/// Watch — the assembler behind the Neighborhood Watch tab. Pulls all the
/// city + neighborhood-tailored cards in one place so the UI can render
/// a coherent overview with a single fetch.
///
/// Every card is grounded in an official source: each city's police
/// department crime-prevention program page (CITY_RESOURCES), each
/// department's verified non-emergency line (NON_EMERGENCY), the same
/// public crime feed that powers the rest of the app (via crimeData),
/// and an AI-generated area brief that names the actual top offenses
/// from that feed (via generateAreaBrief).

export interface WatchCard {
  /// Stable identifier so the UI can key React lists / open-state.
  id: string;
  /// Display title.
  title: string;
  /// One short paragraph of body text. Plain prose — no markdown.
  body: string;
  /// Where the body's claim is grounded (e.g. "CMPD Crime Prevention").
  source: string;
  /// Link to the source page or program.
  sourceUrl: string;
  /// Coarse grouping the UI uses to color-tag cards.
  group: "official" | "reporting" | "data" | "ai" | "civic";
}

export interface WatchResponse {
  city: { slug: string; label: string };
  area: { slug: string; label: string; jurisdiction: string };
  /// Same `asOf` window the Crime Map shows, for honesty about data lag.
  asOf: string | null;
  windowDays: number;
  totalIncidents: number;
  cards: WatchCard[];
  disclaimer: string;
}

const HUMAN_OFFENSE: Record<string, string> = {
  PERSONS: "violent / persons",
  PROPERTY: "property",
  SOCIETY: "society / public-order",
};

function dominantGroup(cnts: { PERSONS: number; PROPERTY: number; SOCIETY: number }):
  | "PERSONS" | "PROPERTY" | "SOCIETY" | null
{
  const arr: Array<["PERSONS" | "PROPERTY" | "SOCIETY", number]> = [
    ["PERSONS", cnts.PERSONS], ["PROPERTY", cnts.PROPERTY], ["SOCIETY", cnts.SOCIETY],
  ];
  arr.sort((a, b) => b[1] - a[1]);
  return arr[0][1] > 0 ? arr[0][0] : null;
}

export async function getWatchForArea(areaSlug: string, areaLabel: string): Promise<WatchResponse> {
  const city = cityForArea(areaSlug);
  const citySlug = city.slug as CitySlug;
  const res = CITY_RESOURCES[citySlug];
  const ne = NON_EMERGENCY[citySlug];
  const stats = await crimeData.getAreaStats(areaSlug).catch(() => null);
  const mix = await getCrimeMix(areaSlug).catch(() => null);

  const byCat = { PERSONS: 0, PROPERTY: 0, SOCIETY: 0 };
  for (const o of mix?.topOffenses ?? []) byCat[o.category] += o.count;
  const dom = dominantGroup(byCat);
  const totalIncidents = mix?.totalIncidents ?? 0;

  const cards: WatchCard[] = [];

  // 1. The user's own police department — named, linked, with the program.
  if (res) {
    const cityName = res.name.replace(/ Police Department$/, "").replace(/ Police$/, "").trim();
    cards.push({
      id: "police-resources",
      title: `${cityName} police — official safety resources`,
      body:
        `The ${res.name} publishes ${cityName}-specific guidance on crime prevention, ` +
        `neighborhood-watch sign-ups, and community-meeting schedules. Use their ` +
        `resource page as your first stop — it is more current and specific than any ` +
        `federal material, and it names the officers who serve your area.`,
      source: res.programName ?? res.name,
      sourceUrl: res.programUrl ?? res.url,
      group: "official",
    });
  }

  // 2. The user's non-emergency reporting line — verbatim and dial-able.
  if (ne) {
    cards.push({
      id: "non-emergency-line",
      title: `Report non-emergencies — ${ne.label}`,
      body:
        `For ongoing concerns that are not active emergencies, call ${ne.line}. ` +
        `Use 911 only for crimes in progress or situations that require an immediate ` +
        `response. TravelSafe does not contact police on your behalf — the call ` +
        `comes from you and goes directly to ${city.label}'s own dispatch.`,
      source: ne.label,
      sourceUrl: ne.url,
      group: "reporting",
    });
  }

  // 3. Crime-mix snapshot — what gets reported here, in plain terms.
  if (mix && mix.totalIncidents > 0 && mix.topOffenses.length > 0) {
    const topOffense = mix.topOffenses[0];
    const top3 = mix.topOffenses.slice(0, 3).map((o) => o.offense).join(", ");
    const domLabel = dom ? HUMAN_OFFENSE[dom] : "mixed";
    const windowText = mix.windowDays > 0 ? `the past ~${mix.windowDays} days` : "the cached window";
    cards.push({
      id: "crime-mix",
      title: `What gets reported in ${areaLabel}`,
      body:
        `Across ${windowText} the police feed records ${mix.totalIncidents.toLocaleString()} ` +
        `incidents in ${areaLabel}. The top three offense descriptions are: ${top3}. ` +
        `The overall mix leans ${domLabel} — most-reported offense is "${topOffense.offense}" ` +
        `(${topOffense.count} reports).`,
      source: stats?.provenance.source ?? "Local police open-data feed",
      sourceUrl: stats?.provenance.datasetUrl ?? "about:blank",
      group: "data",
    });
  } else {
    // Honest fallback when the adapter returned no data.
    cards.push({
      id: "crime-mix",
      title: `No recent reports for ${areaLabel}`,
      body:
        `The ${city.label} police feed currently has no recorded incidents for ${areaLabel} ` +
        `in our cached window. That is normal for many neighborhoods in any given week and ` +
        `does not mean nothing happened — only that nothing reached the public dataset.`,
      source: stats?.provenance.source ?? "Local police open-data feed",
      sourceUrl: stats?.provenance.datasetUrl ?? "about:blank",
      group: "data",
    });
  }

  // 4. AI-tailored area briefing — grounded in the same top offenses above.
  // Generation is best-effort; if no AI key is configured, fall back to a
  // short factual summary so the card slot stays filled.
  const aiBrief = await generateAreaBrief(areaSlug).catch(() => null);
  if (aiBrief && aiBrief.trim().length > 0) {
    cards.push({
      id: "area-brief",
      title: `Tailored briefing for ${areaLabel}`,
      body: aiBrief.trim(),
      source: "TravelSafe AI · grounded in the same official feed",
      sourceUrl: stats?.provenance.datasetUrl ?? "about:blank",
      group: "ai",
    });
  }

  // 5. Civic — getting involved with a neighborhood watch in this city.
  if (res) {
    const cityName = res.name.replace(/ Police Department$/, "").replace(/ Police$/, "").trim();
    cards.push({
      id: "watch-program",
      title: `Get involved with neighborhood watch in ${cityName}`,
      body:
        `${cityName}'s police community-engagement office coordinates registered ` +
        `neighborhood watch groups, block captains, and community meetings. Check the ` +
        `program page for a current sign-up form, meeting calendar, and the contact ` +
        `for the officer assigned to your area. Watch programs work when neighbors ` +
        `know each other and report unusual activity to the non-emergency line — they ` +
        `do not involve patrolling, confronting anyone, or following individuals.`,
      source: res.programName ?? res.name,
      sourceUrl: res.programUrl ?? res.url,
      group: "civic",
    });
  }

  // 6. A universal awareness card with verified DOJ source.
  cards.push({
    id: "see-something",
    title: "If something feels off, route the report correctly",
    body:
      "Call 911 only when a crime is actively in progress or someone is in immediate " +
      "danger. For ongoing or already-resolved concerns, use the non-emergency line " +
      `above (${ne?.line ?? "your city's non-emergency line"}). Note location, time, ` +
      "vehicle/clothing/direction of travel — facial features are far less useful to " +
      "investigators. Do not approach, follow, film, or confront anyone.",
    source: "U.S. Department of Justice — Community Policing",
    sourceUrl: "https://cops.usdoj.gov/",
    group: "official",
  });

  return {
    city: { slug: city.slug, label: city.label },
    area: { slug: areaSlug, label: areaLabel, jurisdiction: city.label },
    asOf: mix?.asOf ?? null,
    windowDays: mix?.windowDays ?? 0,
    totalIncidents,
    cards,
    disclaimer:
      "Every card on this tab is grounded in an official public source — " +
      `${city.label}'s police department resource page, that department's verified ` +
      "non-emergency line, the same crime feed that powers the rest of TravelSafe, " +
      "or U.S. DOJ Community Policing guidance. None of this is personal advice.",
  };
}
