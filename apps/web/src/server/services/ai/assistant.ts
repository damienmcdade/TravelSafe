import "server-only";
import { z } from "zod";
import { aiConfigured, getAIModel } from "./provider";
import { crimeData } from "../crime-data";
import { CITIES, cityBySlug } from "../crime-data/cities";
import { getSafetyScore, getCitywideSafetyScore } from "../watch/safety-score";

// FBI Crime in the Nation 2024 — most recent published national rates
// (released October 2025), used for the city-vs-national comparison tool.
// Per-100k rates round to the same figures across recent years so the
// numbers are stable; the YEAR label is what gets refreshed when the FBI
// publishes a new annual release.
const NATIONAL_PER_100K = { PERSONS: 364, PROPERTY: 1896 };
const NATIONAL_YEAR = 2024;
const FBI_SOURCE_URL = "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend";
const METHODOLOGY_URL = "/methodology";

// US Census Bureau Vintage 2024 Population Estimates — covers every city
// the app's adapters support. Mirrors the canonical map in safety-score.ts.
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
  "milwaukee":         561_385,
  "las-vegas":       660_929,
  "boise":           237_446,
  "buffalo":         272_140,
  "tucson":          544_417,
  "kansas-city":     510_704,
  "saint-paul":      303_820,
  "pittsburgh":      303_255,
  "phoenix":       1_650_070,
};

// Cities whose adapters publish calls-for-service rather than closed
// NIBRS reports. Scores for these cities are calibrated server-side
// (see CFS_CALIBRATION in safety-score.ts). The assistant needs to
// know so it can explain the calibration to users.
const CFS_CITIES: Record<string, number> = {
  "cleveland":   0.35,
  "new-orleans": 0.40,
  "las-vegas":   0.50,
};

const CITY_LIST_FOR_PROMPT = CITIES.map((c) => c.label).join(", ");

const SYSTEM_PROMPT = `
You are TravelSafe's AI safety guide. Your job: answer user questions about
the ${CITIES.length} US cities TravelSafe supports, drawing ONLY on the live
tools available to you. The tools wrap official city police open-data feeds
(NIBRS or calls-for-service depending on the city) and the FBI's Crime in
the Nation ${NATIONAL_YEAR} national averages.

CITIES SUPPORTED (${CITIES.length}): ${CITY_LIST_FOR_PROMPT}.

RULES OF ENGAGEMENT
- Always call a tool before reporting a number. Don't guess, don't recall
  numbers from training. If the user names a city not in the list above,
  say so directly.
- ALWAYS cite the source URL the tool returns. Every claim about a city
  or area must end with a parenthetical containing the source's short
  label, e.g. "(SDPD NIBRS, data.sandiego.gov)". This lets the user
  verify any number against the original feed.
- When discussing the per-area Safety Index grade (A-E), use the
  area_grade tool — that returns the same grade the UI shows. The grade
  on per-neighborhood views compares the AREA's rate to its CITY's
  rate (not national). The grade on citywide views compares the CITY's
  rate to the FBI national average.
- For Cleveland, New Orleans, and Las Vegas, the underlying feed is
  calls-for-service rather than closed NIBRS reports. Rates are
  calibrated (Cleveland ×0.35, New Orleans ×0.40, Las Vegas ×0.50) so
  they're comparable to NIBRS cities. If a user asks about one of these
  cities, mention the calibration briefly in your response and link to
  ${METHODOLOGY_URL} for the full explainer.

TONE
Calm, factual, neutral. Never alarmist, never reassuring in a way that
hides risk. If a user asks something the tools don't cover (a city
TravelSafe doesn't support, a question about a specific named person, a
question requiring web search), say plainly that you can't answer it
from your sources and suggest what you CAN show them.

HARD RULES
- Never identify or track individual people. Never return person names,
  street addresses below the block level, vehicle license plates, photos,
  descriptions of individuals, or other identifying details. ONLY surface
  neighborhood- and city-level aggregates.
- Even if a tool's raw response includes an individual's name or a
  precise address, redact it before returning a response to the user.
- Never make demographic claims about who commits or is affected by crime
  (race, ethnicity, religion, age, gender, sexual orientation).
- Never characterize a neighborhood as "dangerous", "unsafe", or "bad" —
  describe what was reported and let the user draw conclusions. Reports
  reflect police activity, not character judgments. Phrasing that could
  be construed as redlining (housing, lending, insurance, hiring guidance)
  is forbidden.
- Never encourage users to confront, follow, film, or otherwise approach
  any person. Direct them to call 911 in an emergency.
- When asked about sex offender registries, do not list individuals;
  redirect users to the official state Megan's Law / equivalent website.
- If asked to compare neighborhoods in a way that could read as racial
  profiling, decline and explain why.

STYLE
- Short paragraphs. Numbers with their unit and time window
  ("recent cached window", "last 30 days for DC", "rolling sample").
- Lead with the grade when one exists; follow with the rate and counts.
- When a tool returns an empty result for an area, say so — never guess.
- When data is approximate (rolling window, capped row count, low
  data-confidence flag), say so.
- End every numeric claim with a source citation in parentheses.

The user's UI shows the active city via a header pill. You don't have
access to it directly — if the question is ambiguous about which city,
ask, or call list_supported_cities and offer choices.
`.trim();

// ---- Tools ------------------------------------------------------------------

function citySlugList(): string[] {
  return CITIES.map((c) => c.slug);
}

async function listSupportedCities() {
  return {
    cities: CITIES.map((c) => ({
      slug: c.slug,
      label: c.label,
      population_2024: CITY_POPULATION[c.slug] ?? null,
      data_source_type: CFS_CITIES[c.slug] ? "calls-for-service" : "nibrs",
      cfs_calibration: CFS_CITIES[c.slug] ?? null,
    })),
    note: `${CITIES.length} cities total. Cities flagged "calls-for-service" have their per-100k rates scaled by the listed calibration factor to be comparable to NIBRS-based cities.`,
    methodology_url: METHODOLOGY_URL,
  };
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
  // Sample provenance from the first alert (every alert in a city
  // carries the same upstream provenance).
  const provenance = cw.alerts[0]?.provenance ?? null;
  return {
    city: city.label,
    total_incidents_in_recent_window: cw.totalIncidents,
    distinct_areas: cw.perArea.length,
    top_offenses: cw.topOffenses.slice(0, 10),
    top_areas_by_incidents: top,
    source: provenance ? { label: provenance.source, url: provenance.datasetUrl } : null,
    methodology_url: METHODOLOGY_URL,
    cfs_calibration: CFS_CITIES[slug] ?? null,
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
  const provenance = cw.alerts[0]?.provenance ?? null;
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
    source: provenance ? { label: provenance.source, url: provenance.datasetUrl } : null,
    note: "Risk level is a 1-5 bucket derived from incident count in the cached window — not a calendar-year rate. For the A-E Safety Index grade users see in the UI, call area_grade. TravelSafe categorizes by NIBRS group: PERSONS = violent (assault, robbery, etc.), PROPERTY = theft/burglary/etc., SOCIETY = drugs/weapons/order offenses.",
  };
}

async function areaGrade(slug: string, area_slug: string, area_label: string) {
  const city = cityBySlug(slug);
  if (!city) return { error: `Unknown city slug "${slug}".` };
  try {
    const score = await getSafetyScore(area_slug, area_label);
    return {
      city: city.label,
      area: score.area.label,
      grade: score.grade,
      headline: score.headline,
      window_days: score.windowDays,
      population_estimate: score.populationEstimate,
      rows: score.rows.map((r) => ({
        category: r.category,
        count: r.count,
        local_per_100k: r.localPer100k,
        city_per_100k: r.cityPer100k,
        city_delta_pct: r.cityDeltaPct,
        national_per_100k: r.nationalPer100k,
        national_delta_pct: r.deltaPct,
      })),
      data_confidence: score.dataConfidence,
      data_confidence_note: score.dataConfidenceNote ?? null,
      data_source_type: score.dataSourceType,
      cfs_scale: score.cfsScale,
      source: { label: score.source.label, url: score.source.url },
      methodology_url: METHODOLOGY_URL,
      note: "The per-area grade compares this area's rate to its OWN CITY'S rate (city_delta_pct), NOT to the national average. The national comparison is kept as secondary context (national_delta_pct). When citing in your response, prefer the city-relative framing.",
    };
  } catch (err) {
    return { error: `Could not compute area grade: ${(err as Error).message}` };
  }
}

async function compareCityToNational(slug: string) {
  const city = cityBySlug(slug);
  if (!city) return { error: `Unknown city slug "${slug}".` };
  const pop = CITY_POPULATION[slug];
  if (!pop) return { error: `No population estimate registered for ${city.label}.` };
  try {
    // Prefer the canonical citywide score endpoint — it applies CFS
    // calibration + has dataConfidence built in, so the assistant
    // gets the same view the UI shows.
    const score = await getCitywideSafetyScore(slug);
    return {
      city: city.label,
      population_2024: pop,
      window_days: score.windowDays,
      grade: score.grade,
      headline: score.headline,
      rates_per_100k: {
        persons: score.rows.find((r) => r.category === "PERSONS")?.localPer100k ?? 0,
        property: score.rows.find((r) => r.category === "PROPERTY")?.localPer100k ?? 0,
      },
      fbi_national_per_100k: NATIONAL_PER_100K,
      fbi_year: NATIONAL_YEAR,
      fbi_source_url: FBI_SOURCE_URL,
      data_confidence: score.dataConfidence,
      data_confidence_note: score.dataConfidenceNote ?? null,
      data_source_type: score.dataSourceType,
      cfs_scale: score.cfsScale,
      source: { label: score.source.label, url: score.source.url },
      methodology_url: METHODOLOGY_URL,
      note: "Local rates are annualized from the recent cached window; FBI national rates are calendar-year. Comparison is directional, not precise. " +
        (CFS_CITIES[slug] ? `Note: ${city.label} publishes calls-for-service; rates are calibrated ×${CFS_CITIES[slug]} to be comparable to NIBRS cities. See ${METHODOLOGY_URL} for details.` : ""),
    };
  } catch (err) {
    return { error: `Could not compute city score: ${(err as Error).message}` };
  }
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
        `Return the ${CITIES.length} TravelSafe-supported cities with slugs, Vintage 2024 population, data-source type (NIBRS vs calls-for-service), and CFS calibration factor where applicable. Call when the user asks "what cities do you support?" or hasn't named one yet.`,
      inputSchema: z.object({}),
      execute: async () => listSupportedCities(),
    }),
    city_summary: tool({
      description:
        "Return a citywide overview for a TravelSafe-supported city: total incidents in the recent window, top 10 neighborhoods by incident count, top 10 offenses citywide, and the per-category breakdown for each top area. Use this whenever the user asks about a city overall (e.g., 'how does Chicago compare', 'what's the busiest area in Seattle'). Returns a source URL — cite it.",
      inputSchema: z.object({
        city_slug: z.string().describe("One of: " + citySlugList().join(", ")),
      }),
      execute: async ({ city_slug }) => citySummary(city_slug),
    }),
    neighborhood_detail: tool({
      description:
        "Look up a specific neighborhood / police district / precinct / cluster by name within a city. Use for questions like 'tell me about Hollywood' or 'what's the crime mix in Hyde Park'. Pass the user's free-text area name as area_query; the tool does fuzzy substring matching. Returns incident counts + a source URL — for the A-E grade, use area_grade.",
      inputSchema: z.object({
        city_slug: z.string().describe("One of: " + citySlugList().join(", ")),
        area_query: z.string().describe("Neighborhood / district / precinct name as the user said it"),
      }),
      execute: async ({ city_slug, area_query }) => neighborhoodDetail(city_slug, area_query),
    }),
    area_grade: tool({
      description:
        "Get the A-E Safety Index grade for a specific neighborhood — the SAME grade the UI shows on /safety-score and /cities/[city]/[neighborhood]. Compares the area's per-100k rate to its OWN CITY's rate (not national). Returns grade, headline, per-category rates with both city and national comparisons, dataConfidence flag, and CFS calibration when relevant. Use this whenever the user asks 'what's the safety grade for X' or 'how does X compare to its city'.",
      inputSchema: z.object({
        city_slug: z.string().describe("One of: " + citySlugList().join(", ")),
        area_slug: z.string().describe("The area's slug (call neighborhood_detail first to resolve a user's free-text name to a slug)"),
        area_label: z.string().describe("The area's human-readable label"),
      }),
      execute: async ({ city_slug, area_slug, area_label }) => areaGrade(city_slug, area_slug, area_label),
    }),
    compare_city_to_national: tool({
      description:
        "Compute the city's per-100,000 rates for Persons (violent) and Property crime from the recent cached window and compare them to the FBI Crime in the Nation 2024 national averages. Returns the A-E grade, dataConfidence flag, and CFS calibration when applicable. Use this when the user asks 'is X safer than the rest of the country' or for any city-vs-national comparison. Cite the source URL in your response.",
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
