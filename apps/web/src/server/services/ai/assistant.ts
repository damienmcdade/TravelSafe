import "server-only";
import { z } from "zod";
import { aiConfigured, getAIModel } from "./provider";
import { crimeData } from "../crime-data";
import { CITIES, cityBySlug } from "../crime-data/cities";

// FBI Crime in the Nation 2024 — most recent published national rates
// (released October 2025), used for the city-vs-national comparison tool.
// Per-100k rates round to the same figures across recent years so the
// numbers are stable; the YEAR label is what gets refreshed when the FBI
// publishes a new annual release.
const NATIONAL_PER_100K = { PERSONS: 364, PROPERTY: 1896 };
const NATIONAL_YEAR = 2024;

// US Census Bureau Vintage 2023 Population Estimates — covers every city
// the app's adapters support. Previously this map only had 11 entries,
// silently dropping any per-100k city-vs-national tool call for the other
// 18. Now mirrors the canonical map in safety-score.ts.
const CITY_POPULATION: Record<string, number> = {
  "san-diego":     1_381_611,
  "los-angeles":   3_820_914,
  "san-francisco":   808_988,
  "chicago":       2_664_452,
  "seattle":         755_078,
  "new-york":      8_258_035,
  "denver":          716_577,
  "detroit":         633_218,
  "washington-dc":   678_972,
  "boston":          650_706,
  "philadelphia":  1_550_542,
  "oakland":         430_553,
  "cincinnati":      311_097,
  "new-orleans":     364_136,
  "baton-rouge":     217_665,
  "cambridge":       118_488,
  "dallas":        1_302_868,
  "charlotte":       897_720,
  "nashville":       687_788,
  "minneapolis":     421_874,
  "cleveland":       362_656,
  "montgomery-county": 1_058_812,
  "las-vegas":       660_929,
  "boise":           237_446,
  "buffalo":         272_140,
  "tucson":          544_417,
  "kansas-city":     510_704,
  "saint-paul":      303_820,
  "pittsburgh":      303_255,
};

const SYSTEM_PROMPT = `
You are TravelSafe's AI safety guide. Your job: answer user questions about
US states, cities, and neighborhoods that TravelSafe supports, drawing only
on the live tools available to you. The tools wrap official police data
feeds (SDPD NIBRS, LAPD Crime Data, SFPD Incident Reports, Chicago CPD,
Seattle SPD, NYPD Complaint Data, Denver Crime Offenses, Detroit RMS, DC
MPD, Boston BPD, Philadelphia PPD) and the FBI's Crime in the Nation 2024
national averages. Always call a tool before reporting a number — don't
guess.

Tone: calm, factual, neutral. Never alarmist, never reassuring in a way
that hides risk. If a user asks something the tools don't cover (a city
TravelSafe doesn't support, a question about a specific named person, a
question requiring web search), say plainly that you can't answer it
from your sources and suggest what you CAN show them.

Hard rules:
- Never identify or track individual people. Never display names, photos,
  vehicle plates, or other identifying details.
- Never make demographic claims about who commits or is affected by crime
  (race, ethnicity, religion, age, gender, sexual orientation).
- Never encourage users to confront, follow, film, or otherwise approach
  any person. Direct them to call 911 in an emergency.
- When asked about sex offender registries, do not list individuals;
  redirect users to the official state Megan's Law website.
- If asked to compare neighborhoods in a way that could read as racial
  profiling, decline and explain why.

Style:
- Short paragraphs. Numbers with their unit and time window
  ("recent cached window", "last 30 days for DC", "rolling sample").
- When a tool returns an empty result for an area, say so — never guess.
- When data is approximate (rolling window, capped row count), say so.

The user's UI shows the active city via a header pill. You don't have
access to it directly — if the question is ambiguous about which city,
ask, or call list_supported_cities and offer choices.
`.trim();

// ---- Tools ------------------------------------------------------------------

function citySlugList(): string[] {
  return CITIES.map((c) => c.slug);
}

async function listSupportedCities() {
  return CITIES.map((c) => ({
    slug: c.slug,
    label: c.label,
    population_2023: CITY_POPULATION[c.slug] ?? null,
  }));
}

async function citySummary(slug: string) {
  const city = cityBySlug(slug);
  if (!city) return { error: `Unknown city slug "${slug}". Try one of: ${citySlugList().join(", ")}.` };
  const cw = await crimeData.getCitywide(slug);
  const top = cw.perArea.slice(0, 10).map((p) => ({
    area: p.label,
    incidents: p.incidentCount,
    persons: p.byCategory.PERSONS,
    property: p.byCategory.PROPERTY,
    society: p.byCategory.SOCIETY,
    dominant: p.dominantCategory,
  }));
  return {
    city: city.label,
    total_incidents_in_recent_window: cw.totalIncidents,
    distinct_areas: cw.perArea.length,
    top_offenses: cw.topOffenses.slice(0, 10),
    top_areas_by_incidents: top,
    note: "Counts are from the most recent cached window for the city's official feed. Cities differ in publication cadence; see TravelSafe's source notes per city.",
  };
}

async function neighborhoodDetail(slug: string, area_query: string) {
  const city = cityBySlug(slug);
  if (!city) return { error: `Unknown city slug "${slug}".` };
  const cw = await crimeData.getCitywide(slug);
  const q = area_query.toLowerCase();
  const hit = cw.perArea.find((p) =>
    p.label.toLowerCase() === q ||
    p.label.toLowerCase().includes(q) ||
    p.slug.toLowerCase() === q ||
    p.slug.toLowerCase().includes(q),
  );
  if (!hit) {
    const closest = cw.perArea
      .filter((p) => p.label.toLowerCase().includes(q.split(" ")[0] ?? ""))
      .slice(0, 5)
      .map((p) => p.label);
    return {
      error: `No exact match for "${area_query}" in ${city.label}.`,
      closest_matches: closest,
    };
  }
  return {
    city: city.label,
    area: hit.label,
    slug: hit.slug,
    incidents_in_recent_window: hit.incidentCount,
    persons: hit.byCategory.PERSONS,
    property: hit.byCategory.PROPERTY,
    society: hit.byCategory.SOCIETY,
    dominant_category: hit.dominantCategory,
    risk_level: hit.riskLevel,
    note: "Risk level is a 1-5 bucket derived from incident count in the cached window — not a calendar-year rate. TravelSafe categorizes by NIBRS group: PERSONS = violent (assault, robbery, etc.), PROPERTY = theft/burglary/etc., SOCIETY = drugs/weapons/order offenses.",
  };
}

async function compareCityToNational(slug: string) {
  const city = cityBySlug(slug);
  if (!city) return { error: `Unknown city slug "${slug}".` };
  const pop = CITY_POPULATION[slug];
  if (!pop) return { error: `No population estimate registered for ${city.label}.` };
  const cw = await crimeData.getCitywide(slug);
  const totals = cw.perArea.reduce(
    (acc, p) => ({ PERSONS: acc.PERSONS + p.byCategory.PERSONS, PROPERTY: acc.PROPERTY + p.byCategory.PROPERTY }),
    { PERSONS: 0, PROPERTY: 0 },
  );
  const rate = (n: number) => (n / pop) * 100_000;
  return {
    city: city.label,
    population_2023: pop,
    window: "recent cached pull (varies by city; rolling, not a calendar year)",
    rates_per_100k: {
      persons: Math.round(rate(totals.PERSONS)),
      property: Math.round(rate(totals.PROPERTY)),
    },
    fbi_national_per_100k: NATIONAL_PER_100K,
    fbi_year: NATIONAL_YEAR,
    note: `Because the local window is rolling and the FBI reports a calendar year, this is a directional comparison ("higher than typical" vs "lower than typical"), not a precise apples-to-apples rate.`,
  };
}

// ---- streamText entry point -------------------------------------------------

export async function streamAssistant(messages: Array<{ role: "user" | "assistant"; content: string }>) {
  if (!aiConfigured()) {
    return { configured: false as const };
  }
  const model = await getAIModel();
  if (!model) return { configured: false as const };
  const { streamText, tool } = await import("ai");

  const tools = {
    list_supported_cities: tool({
      description:
        "Return the list of every city TravelSafe currently supports, with their slugs and US Census Vintage 2023 population estimates. Call this when the user asks 'what cities do you support?' or hasn't named one yet.",
      inputSchema: z.object({}),
      execute: async () => listSupportedCities(),
    }),
    city_summary: tool({
      description:
        "Return a citywide overview for a TravelSafe-supported city: total incidents in the recent window, top 10 neighborhoods by incident count, top 10 offenses citywide, and the per-category breakdown for each top area. Use this whenever the user asks about a city overall (e.g., 'how does Chicago compare', 'what's the worst area in Seattle').",
      inputSchema: z.object({
        city_slug: z.string().describe("One of: " + citySlugList().join(", ")),
      }),
      execute: async ({ city_slug }) => citySummary(city_slug),
    }),
    neighborhood_detail: tool({
      description:
        "Look up a specific neighborhood / police district / precinct / cluster by name within a city. Use this for questions like 'tell me about Hollywood' or 'what's the crime mix in Hyde Park'. Pass the user's free-text area name as area_query; the tool does fuzzy substring matching.",
      inputSchema: z.object({
        city_slug: z.string().describe("One of: " + citySlugList().join(", ")),
        area_query: z.string().describe("Neighborhood / district / precinct name as the user said it"),
      }),
      execute: async ({ city_slug, area_query }) => neighborhoodDetail(city_slug, area_query),
    }),
    compare_city_to_national: tool({
      description:
        "Compute the city's per-100,000 rates for Persons (violent) and Property crime from the recent cached window and compare them to the FBI Crime in the Nation 2024 national averages. Use this when the user asks 'is X safer than the rest of the country' or for any city-vs-national comparison.",
      inputSchema: z.object({
        city_slug: z.string().describe("One of: " + citySlugList().join(", ")),
      }),
      execute: async ({ city_slug }) => compareCityToNational(city_slug),
    }),
  };

  const result = await streamText({
    model: model as Parameters<typeof streamText>[0]["model"],
    system: SYSTEM_PROMPT,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    tools,
    // Cap chains so a runaway tool loop can't burn the budget.
    stopWhen: ({ steps }) => steps.length >= 6,
  });

  return { configured: true as const, stream: result };
}
