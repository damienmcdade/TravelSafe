import "server-only";
import { crimeData } from "../crime-data";
import { cityForArea } from "../crime-data/cities";
import { loadPolygonAreas, lookupAreaKm2, totalCityKm2 } from "../../lib/polygon-areas";
import { HttpError } from "../../lib/http";

/// Safety Score — compares the user's selected area against the FBI's most
/// recent national rates per 100,000 residents. Returns the raw local and
/// national numbers so the UI can render whatever shape it wants without
/// re-doing the math.
///
/// FBI Crime in the Nation 2024 (released October 2025) is the latest annual
/// release. The numbers below match the rates the FBI publishes on the
/// current Crime Data Explorer at cde.ucr.cjis.gov. The link goes straight
/// to the trend view so users can verify.

export const FBI_NATIONAL_PER_100K_2024 = { PERSONS: 364, PROPERTY: 1896 };
export const FBI_NATIONAL_SOURCE = {
  label: "FBI Crime in the Nation 2024 (Uniform Crime Reporting)",
  url: "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend",
  publishedYear: 2024,
};

// US Census Bureau Vintage 2023 city population estimates — the most recent
// official annual estimate for each city we support. Used both for citywide
// and as a per-area baseline (population per area is approximated by even
// distribution across the city's named neighborhoods).
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

export interface SafetyScoreRow {
  category: "PERSONS" | "PROPERTY";
  /// Incidents in this area for the cached window.
  count: number;
  /// Annualized per-100k rate for this area, given a population estimate.
  localPer100k: number;
  /// FBI national average for the same category, same year.
  nationalPer100k: number;
  /// Percentage delta vs national. Positive = above national.
  deltaPct: number;
}

export interface SafetyScoreResponse {
  city: { slug: string; label: string };
  area: { slug: string; label: string };
  /// Population estimate used for the rate. For neighborhoods this is
  /// approximated by dividing the city total across all known neighborhoods.
  populationEstimate: number;
  /// What window of the police feed this score reflects (in days).
  windowDays: number;
  /// Most recent incident date inside the window.
  asOf: string | null;
  /// One letter grade derived from how far below / above national the area
  /// sits. The thresholds are conservative — only material deviations get an
  /// A or D. Local ≤ 60% of national → A; ≤ 90% → B; ≤ 130% → C; ≤ 200% → D;
  /// > 200% → E. Computed on the average percentile across the two reported
  /// categories so a property-crime spike alone can't tank the grade.
  grade: "A" | "B" | "C" | "D" | "E";
  /// Plain-English headline the UI can drop straight into a card.
  headline: string;
  rows: SafetyScoreRow[];
  source: typeof FBI_NATIONAL_SOURCE;
  disclaimer: string;
}

function gradeFromDeltas(rows: SafetyScoreRow[]): SafetyScoreResponse["grade"] {
  // Average the local/national ratio across the two reported categories.
  const ratios = rows.map((r) => r.nationalPer100k > 0 ? r.localPer100k / r.nationalPer100k : 1);
  if (ratios.length === 0) return "C";
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  if (avg <= 0.6) return "A";
  if (avg <= 0.9) return "B";
  if (avg <= 1.3) return "C";
  if (avg <= 2.0) return "D";
  return "E";
}

function headlineFor(grade: SafetyScoreResponse["grade"], areaLabel: string, cityLabel: string): string {
  switch (grade) {
    case "A": return `${areaLabel} reports lower per-100k rates than the FBI national average for ${cityLabel}-area neighborhoods.`;
    case "B": return `${areaLabel} reports below the FBI national rate.`;
    case "C": return `${areaLabel} reports close to the FBI national rate.`;
    case "D": return `${areaLabel} reports higher per-100k rates than the FBI national average. Use the cards below to see which category drives the gap.`;
    case "E": return `${areaLabel} reports notably higher per-100k rates than the FBI national average. Use the Awareness tab for the offense mix.`;
  }
}

/// Citywide variant. Aggregates every tracked neighborhood's incidents into
/// a single rate-per-100k against the FBI 2024 national average. Used as
/// the default Safety Score view when the user hasn't drilled into a
/// specific neighborhood — population denominator is the full US Census
/// city total rather than an even-split per-area approximation, so the
/// comparison reflects the city's actual reported rate.
export async function getCitywideSafetyScore(citySlug: string): Promise<SafetyScoreResponse> {
  const { cityBySlug } = await import("../crime-data/cities");
  const city = cityBySlug(citySlug) ?? cityForArea("");
  const cityPop = CITY_POPULATION[city.slug] ?? 0;
  const areas = await city.discover().catch(() => []);

  // Sum NIBRS Persons + Property counts across every tracked neighborhood.
  // We deliberately re-use the per-area adapter cache here — discover()
  // populates the same cache the rest of the app reads, so the loop is
  // effectively one upstream pull regardless of city size.
  let persons = 0, property = 0;
  let earliest = Infinity, latest = 0;
  // Parallelize the per-area fetches. The adapter caches its underlying
  // upstream pull, so for a city with N neighborhoods we still only hit
  // the police feed ONCE on cold cache regardless of how many areas the
  // loop iterates — but the per-area dispatch into the adapter still has
  // a few ms of overhead each. Promise.all collapses N×O(ms) into one
  // round-trip, which matters for cities like Detroit (199 areas) and
  // Oakland (134 areas).
  const perArea = await Promise.all(
    areas.map((a) => crimeData.getIncidents(a.slug, { limit: 5000 }).catch(() => [])),
  );
  for (const incidents of perArea) {
    for (const i of incidents) {
      const k = i.nibrsCategory as "PERSONS" | "PROPERTY" | "SOCIETY";
      if (k === "PERSONS") persons += 1;
      else if (k === "PROPERTY") property += 1;
      const t = +new Date(i.occurredAt);
      if (Number.isFinite(t) && t > 0) {
        if (t < earliest) earliest = t;
        if (t > latest) latest = t;
      }
    }
  }
  const windowDays = (latest > 0 && earliest < Infinity)
    ? Math.max(1, Math.round((latest - earliest) / (24 * 60 * 60 * 1000)))
    : 0;
  // Full city population — no per-area division. The Vintage 2023 Census
  // total is the canonical denominator the FBI itself uses to publish
  // city-vs-national rates.
  const pop = cityPop;
  const annualize = (count: number) => {
    if (pop <= 0 || windowDays <= 0) return 0;
    const annualCount = count * (365 / windowDays);
    return (annualCount / pop) * 100_000;
  };

  const rows: SafetyScoreRow[] = [
    {
      category: "PERSONS",
      count: persons,
      localPer100k: Math.round(annualize(persons)),
      nationalPer100k: FBI_NATIONAL_PER_100K_2024.PERSONS,
      deltaPct: FBI_NATIONAL_PER_100K_2024.PERSONS === 0 ? 0
        : Math.round(((annualize(persons) - FBI_NATIONAL_PER_100K_2024.PERSONS) / FBI_NATIONAL_PER_100K_2024.PERSONS) * 100),
    },
    {
      category: "PROPERTY",
      count: property,
      localPer100k: Math.round(annualize(property)),
      nationalPer100k: FBI_NATIONAL_PER_100K_2024.PROPERTY,
      deltaPct: FBI_NATIONAL_PER_100K_2024.PROPERTY === 0 ? 0
        : Math.round(((annualize(property) - FBI_NATIONAL_PER_100K_2024.PROPERTY) / FBI_NATIONAL_PER_100K_2024.PROPERTY) * 100),
    },
  ];

  const grade = gradeFromDeltas(rows);
  const cityLabel = `${city.label} (citywide)`;
  const headline = headlineFor(grade, cityLabel, city.label);

  return {
    city: { slug: city.slug, label: city.label },
    area: { slug: city.slug, label: cityLabel },
    populationEstimate: pop,
    windowDays,
    asOf: latest > 0 ? new Date(latest).toISOString() : null,
    grade,
    headline,
    rows,
    source: FBI_NATIONAL_SOURCE,
    disclaimer:
      "Citywide rate is the sum of incidents across every tracked neighborhood, " +
      `annualized from the cached window and scaled to per-100,000 residents using ` +
      `${city.label}'s US Census Bureau Vintage 2023 population (${pop.toLocaleString()}). ` +
      "National rates are the FBI Uniform Crime Reporting program's 2024 " +
      "annual release — the same denominator the FBI uses to publish " +
      "official city-vs-national comparisons. Society / public-order " +
      "offenses are excluded because the FBI does not publish a national rate.",
  };
}

export async function getSafetyScore(areaSlug: string, areaLabel: string): Promise<SafetyScoreResponse> {
  const city = cityForArea(areaSlug);
  const cityPop = CITY_POPULATION[city.slug] ?? 0;

  // CREDIBILITY FIX — the previous implementation divided the city
  // population by N_areas to get a per-area denominator (~12k for typical
  // cities), then computed rate-per-100k. For most urban neighborhoods
  // that produced rates 5-20× the FBI national rate, which the score
  // mapping clamped to its floor (5) regardless of how the area actually
  // compared to its peers. Every BlockScore came out the same.
  //
  // We now compute the area's report volume relative to its CITYWIDE PEER
  // AVERAGE (citywide totals / N tracked neighborhoods). A neighborhood
  // reporting the average share gets the city's per-100k rate; one
  // reporting double the share gets 2× that rate; half gets half. The FBI
  // national comparison still appears on the card, but the localPer100k
  // figure varies meaningfully across neighborhoods within the same city.
  //
  // Fan-out cost: discover() + a Promise.all over per-area incident pulls.
  // The adapter cache means the underlying police feed is hit once per
  // city regardless — the per-area dispatch is in-process and fast.
  const areas = await city.discover().catch(() => []);
  const incidentsPerArea = await Promise.all(
    areas.map((a) => crimeData.getIncidents(a.slug, { limit: 5000 }).catch(() => [])),
  );

  // Citywide totals across every tracked neighborhood.
  let cityPersons = 0, cityProperty = 0;
  let earliest = Infinity, latest = 0;
  for (const arr of incidentsPerArea) {
    for (const i of arr) {
      const k = i.nibrsCategory as "PERSONS" | "PROPERTY" | "SOCIETY";
      if (k === "PERSONS") cityPersons += 1;
      else if (k === "PROPERTY") cityProperty += 1;
      const t = +new Date(i.occurredAt);
      if (Number.isFinite(t) && t > 0) {
        if (t < earliest) earliest = t;
        if (t > latest) latest = t;
      }
    }
  }

  // This neighborhood's counts — reuse the fan-out result if discover()
  // returned our slug; otherwise pull directly.
  const idx = areas.findIndex((a) => a.slug === areaSlug);
  const areaIncidents = idx >= 0
    ? incidentsPerArea[idx]
    : await crimeData.getIncidents(areaSlug, { limit: 5000 }).catch(() => []);

  // INCIDENT-PREVENTION INVARIANT (2026-05-22):
  // Earlier we silently returned a score of 100 whenever the per-area
  // function couldn't find any incidents for `areaSlug` (because, e.g.,
  // a caller passed a city slug as if it were a neighborhood slug,
  // which is what /threats was doing via city.defaultArea). The rate
  // math collapsed to localPer100k=0 → ratio=0 → ratioToScore(0)=100
  // = "Lower than national rate". A 100 score that actually meant
  // "we don't have data for this area" was a credibility-destroying
  // bug: users saw 'safer than national' for an area we hadn't even
  // queried.
  //
  // We now fail loudly when the area is unrecognized: if NO incidents
  // came back AND the slug isn't in the city's discovered area list,
  // throw 404. The client treats 404 as "area unknown, show nothing"
  // rather than rendering a misleading 100. Callers that legitimately
  // want a citywide score must use getCitywideSafetyScore (or the
  // ?city= variant of /safezone/safety-score).
  if (areaIncidents.length === 0 && idx < 0) {
    throw new HttpError(
      404,
      "unknown_area",
      `Unknown area slug "${areaSlug}" — not found in ${city.label} adapter's discovered neighborhoods. If you want a citywide score, call getCitywideSafetyScore() or pass ?city= instead of ?area=.`,
    );
  }

  let persons = 0, property = 0;
  for (const i of areaIncidents) {
    const k = i.nibrsCategory as "PERSONS" | "PROPERTY" | "SOCIETY";
    if (k === "PERSONS") persons += 1;
    else if (k === "PROPERTY") property += 1;
  }

  const windowDays = (latest > 0 && earliest < Infinity)
    ? Math.max(1, Math.round((latest - earliest) / (24 * 60 * 60 * 1000)))
    : 0;

  // Citywide annualized rate per 100k — uses the actual US Census Vintage
  // 2023 city population, the same denominator the FBI uses for its
  // official city-vs-national comparisons.
  const annualizeCity = (count: number) => {
    if (cityPop <= 0 || windowDays <= 0) return 0;
    return (count * 365 / windowDays / cityPop) * 100_000;
  };
  const cityPersons100k = annualizeCity(cityPersons);
  const cityProperty100k = annualizeCity(cityProperty);

  // POPULATION DENOMINATOR — two strategies, polygon-area-weighted
  // preferred, peer-share as fallback.
  //
  // 1. Polygon-area weighting (preferred): if the city's GeoJSON file is
  //    available and this area's polygon matches one of its features, we
  //    estimate per-area population as cityPop × (areaKm² / cityTotalKm²).
  //    This accounts for the fact that a tiny downtown core polygon
  //    represents far fewer residents than a sprawling suburban district
  //    of the same name length. Density isn't uniform either, but
  //    polygon-area weighting beats peer-share for cities with very
  //    uneven neighborhood sizes.
  //
  // 2. Peer-share (fallback): when no polygon data is available, use the
  //    citywide totals / N_areas approach so an "average neighborhood"
  //    reports the city's per-100k rate. Preserves cross-neighborhood
  //    variance within the city even without polygon geometry.
  const N = Math.max(1, areas.length);
  const polygonAreas = await loadPolygonAreas(city.slug);
  const ourAreaKm2 = lookupAreaKm2(areaLabel, polygonAreas);
  const cityTotalKm2 = totalCityKm2(polygonAreas);

  let personsScale: number;
  let propertyScale: number;
  let popDenominator: number;
  if (ourAreaKm2 != null && cityTotalKm2 > 0 && cityPop > 0) {
    // Polygon-weighted: per-area pop estimate, then ratio of (this area's
    // count / its pop) to (citywide count / citywide pop).
    const areaPop = cityPop * (ourAreaKm2 / cityTotalKm2);
    popDenominator = Math.round(areaPop);
    const localPersonsRate = areaPop > 0 ? (persons * 365 / Math.max(1, windowDays) / areaPop) * 100_000 : 0;
    const localPropertyRate = areaPop > 0 ? (property * 365 / Math.max(1, windowDays) / areaPop) * 100_000 : 0;
    personsScale = cityPersons100k > 0 ? localPersonsRate / cityPersons100k : 0;
    propertyScale = cityProperty100k > 0 ? localPropertyRate / cityProperty100k : 0;
  } else {
    // Peer-share fallback (unchanged from before).
    popDenominator = cityPop > 0 ? Math.round(cityPop / N) : 0;
    const expectedPersons = cityPersons / N;
    const expectedProperty = cityProperty / N;
    personsScale = expectedPersons > 0 ? persons / expectedPersons : 0;
    propertyScale = expectedProperty > 0 ? property / expectedProperty : 0;
  }
  const persons100k = Math.round(cityPersons100k * personsScale);
  const property100k = Math.round(cityProperty100k * propertyScale);

  const rows: SafetyScoreRow[] = [
    {
      category: "PERSONS",
      count: persons,
      localPer100k: persons100k,
      nationalPer100k: FBI_NATIONAL_PER_100K_2024.PERSONS,
      deltaPct: FBI_NATIONAL_PER_100K_2024.PERSONS === 0 ? 0
        : Math.round(((persons100k - FBI_NATIONAL_PER_100K_2024.PERSONS) / FBI_NATIONAL_PER_100K_2024.PERSONS) * 100),
    },
    {
      category: "PROPERTY",
      count: property,
      localPer100k: property100k,
      nationalPer100k: FBI_NATIONAL_PER_100K_2024.PROPERTY,
      deltaPct: FBI_NATIONAL_PER_100K_2024.PROPERTY === 0 ? 0
        : Math.round(((property100k - FBI_NATIONAL_PER_100K_2024.PROPERTY) / FBI_NATIONAL_PER_100K_2024.PROPERTY) * 100),
    },
  ];

  const grade = gradeFromDeltas(rows);
  const headline = headlineFor(grade, areaLabel, city.label);

  const usedPolygonWeight = ourAreaKm2 != null && cityTotalKm2 > 0 && cityPop > 0;
  return {
    city: { slug: city.slug, label: city.label },
    area: { slug: areaSlug, label: areaLabel },
    populationEstimate: popDenominator,
    windowDays,
    asOf: latest > 0 ? new Date(latest).toISOString() : null,
    grade,
    headline,
    rows,
    source: FBI_NATIONAL_SOURCE,
    disclaimer: usedPolygonWeight
      ? `Per-area rate uses this neighborhood's polygon area (${ourAreaKm2!.toFixed(1)} km²) ` +
        `to estimate population — assuming roughly uniform density across ${city.label}, an area ` +
        `gets a share of ${city.label}'s total population proportional to its share of the city's ` +
        `mapped area. The score then compares the result to the FBI Uniform Crime Reporting program's ` +
        `${FBI_NATIONAL_SOURCE.publishedYear} national average. Society / public-order offenses are ` +
        "excluded because the FBI doesn't publish a national rate for them."
      : `Per-area rate scales ${city.label}'s citywide per-100k rate by this neighborhood's ` +
        `share of recent reports relative to a typical ${city.label} neighborhood. A neighborhood ` +
        `reporting the average ${city.label} share lands at ${city.label}'s citywide rate; one ` +
        `reporting twice the share scales to 2× that rate. The score then compares the result to ` +
        `the FBI Uniform Crime Reporting program's ${FBI_NATIONAL_SOURCE.publishedYear} national average. ` +
        "Society / public-order offenses are excluded because the FBI doesn't publish a national rate for them.",
  };
}
