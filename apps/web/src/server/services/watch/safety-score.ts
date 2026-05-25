import "server-only";
import { crimeData } from "../crime-data";
import { cityForArea } from "../crime-data/cities";
import { loadPolygonAreas, lookupAreaKm2, totalCityKm2 } from "../../lib/polygon-areas";
import { HttpError } from "../../lib/http";
import { knownNeighborhoodPopulation } from "../crime-data/neighborhood-population";
import { CITY_FBI_BASELINES } from "./city-fbi-baselines-generated";

/// Safety Score — compares the user's selected area against the FBI's most
/// recent national rates per 100,000 residents. Returns the raw local and
/// national numbers so the UI can render whatever shape it wants without
/// re-doing the math.
///
/// SOURCE / VINTAGE
/// Numbers below are the FBI Crime Data Explorer's full-year 2025 annual
/// totals (sum of 12 monthly per-100k rates from cde.ucr.cjis.gov), pulled
/// via api.usa.gov/crime/fbi/cde with `tools/fetch-fbi-rates.mjs`. 2025
/// is the most-recent complete year in BOTH the violent-crime and
/// property-crime series as of the last run.
///
/// Year-over-year context (per CDE, for sanity-checking):
///   2025: violent 328, property 1548  ← in use
///   2024: violent 364, property 1771
///   2023: violent 386, property 1954
///   2022: violent 398, property 1999
///
/// To refresh after a new CDE month publishes:
///   FBI_CDE_API_KEY=<your-key> node tools/fetch-fbi-rates.mjs

export const FBI_NATIONAL_PER_100K_2025 = { PERSONS: 328, PROPERTY: 1548 };
/// Kept as aliases for back-compat with consumers that import the
/// older names. They all resolve to the same latest-year constant
/// so updates only need to happen in one place.
export const FBI_NATIONAL_PER_100K_2024 = FBI_NATIONAL_PER_100K_2025;
export const FBI_NATIONAL_PER_100K_2023 = FBI_NATIONAL_PER_100K_2025;
export const FBI_NATIONAL_SOURCE = {
  label: "FBI Crime Data Explorer 2025 (annual sum of monthly UCR rates)",
  url: "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend",
  publishedYear: 2025,
};

// Population estimates and FBI national rates live in shared modules so
// the AI assistant, this scoring engine, and the citywide-comparison card
// all reference the same numbers (the audit caught us drifting across
// three independent copies labeled different vintages).
import { CITY_POPULATION, POPULATION_VINTAGE } from "../crime-data/population";

// CFS calibration factors. Cleveland, NOLA, and Las Vegas publish
// calls-for-service feeds rather than closed NIBRS reports. CFS is
// structurally inflated 3–5× vs NIBRS because (a) a single crime
// often generates multiple dispatches, (b) many dispatches are
// unfounded after investigation, (c) the feeds include some non-crime
// dispatches even after our keyword filters. We apply a per-city
// scaling factor to localPer100k and cityPer100k so the per-100k rate
// is comparable to NIBRS-based cities. The 0.30–0.40 range reflects
// empirical CFS-to-NIBRS ratios reported in criminology literature
// for general crime feeds. A dataConfidence note in the response
// surfaces the calibration to users.
const CFS_CALIBRATION: Record<string, number> = {
  // Cleveland 0.35 → 0.55 (v26). 0.35 was too aggressive: it pulled
  // violent from a raw 2743/100k down to 960/100k, under the FBI
  // baseline of 1360 → misleading Grade A. 0.55 lands violent at
  // ~1509/100k (~1.11× baseline, Grade C — Cleveland is genuinely
  // higher-crime than national average, that's accurate). Property
  // remains under-reported even at 0.55 (~985 vs FBI 3949) which
  // suggests Cleveland's CFS feed structurally publishes fewer
  // property dispatches than violent — separate investigation
  // needed before tuning further. Tracked in #154.
  "cleveland":     0.55,
  // New Orleans 0.40 → 0.80 (v28). Same pattern as Cleveland —
  // 0.40 scaled NOPD's actual rate (~698/100k violent) down to
  // 279/100k, ~5× under the FBI baseline of 1361. 0.80 lands
  // violent at ~558/100k (0.41× baseline, Grade B-ish) and
  // property at ~4282/100k (0.84× baseline). Plausible signal,
  // inside the divergence guard.
  "new-orleans":   0.80,
  "las-vegas":     0.50,
  "boise":         0.30,
};
// POPULATION_VINTAGE is re-exported so consumers can render the label
// without reaching into the shared module independently.
export { POPULATION_VINTAGE };

export interface SafetyScoreRow {
  category: "PERSONS" | "PROPERTY";
  /// Incidents in this area for the cached window.
  count: number;
  /// Annualized per-100k rate for this area, given a population estimate.
  localPer100k: number;
  /// THE city's own annualized rate for the same category — the primary
  /// comparison anchor for per-neighborhood scoring. Comparing a tightly-
  /// bounded urban neighborhood directly to the FBI NATIONAL rate is
  /// structurally misleading because national is averaged across every
  /// rural+urban+suburban area; cities concentrate reportable activity,
  /// and neighborhoods concentrate it further. Comparing to the city's
  /// own rate is the "nearest available official baseline" and produces
  /// a deviation a user can meaningfully act on.
  cityPer100k: number;
  /// Percentage delta vs CITY rate. Positive = above the city's average.
  /// This is the primary signal; deltaPct (vs national) is retained for
  /// reference but no longer drives the grade.
  cityDeltaPct: number;
  /// FBI national average for the same category, same year. Kept as a
  /// secondary reference in the UI's methodology footer so users can
  /// see where the city itself sits relative to national.
  nationalPer100k: number;
  /// Percentage delta vs national. Kept for reference and consumed by
  /// the citywide endpoint (where the comparison anchor is properly
  /// national because the "area" IS the city).
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
  // "N/A" is returned when the underlying adapter has no usable
  // recent data for this area — count is zero AND confidence is low.
  // Previously these areas were graded "C" (because the no-data math
  // collapsed to ratio≈1), which falsely told users "this area is
  // close to average" when the truth was "we don't know yet."
  grade: "A" | "B" | "C" | "D" | "E" | "N/A";
  /// Plain-English headline the UI can drop straight into a card.
  headline: string;
  rows: SafetyScoreRow[];
  source: typeof FBI_NATIONAL_SOURCE;
  disclaimer: string;
  /// How much confidence the data supports. "high" = window + volume
  /// match expected baselines for this city; "medium" = data is short
  /// of expected (grade may shift when the feed refreshes); "low" =
  /// notably under-served (grade should be read as provisional). Driven
  /// by comparing the annualized observed rate against the FBI national
  /// rate baseline — when the upstream feed is partial we annualize a
  /// small sample, producing rates that can flip the grade misleadingly.
  dataConfidence: "high" | "medium" | "low";
  /// Optional human-readable explanation when dataConfidence < "high".
  /// UI surfaces this verbatim as a caveat banner near the grade card.
  dataConfidenceNote?: string;
  /// Source type of the underlying feed.
  ///   "nibrs"  — closed NIBRS incident reports (most cities)
  ///   "cfs"    — calls-for-service / dispatched calls, rate-calibrated
  ///              to approximate NIBRS-equivalent volumes (Cleveland,
  ///              NOLA, Las Vegas)
  /// UI shows a small badge near the score so users know what they're
  /// looking at. The calibration scale is in cfsScale when source=cfs.
  dataSourceType: "nibrs" | "cfs";
  /// Calibration multiplier applied to localPer100k / cityPer100k when
  /// dataSourceType=cfs. Always 1.0 for nibrs. Useful for the UI
  /// tooltip on the CFS badge.
  cfsScale: number;
}

// FBI UCR Part 1 violent + property filters. The FBI's published
// "violent-crime" and "property-crime" national + per-city rates use
// the narrow UCR Part 1 definition. Adapters classify by NIBRS Crime
// Against (Persons/Property/Society), which is BROADER — NIBRS
// "Crimes Against Persons" includes simple assault, intimidation,
// kidnapping, and human-trafficking, none of which are in UCR Part 1
// violent. The result was adapter rates 2-7× the city's FBI-published
// rate. These regex matchers narrow each NIBRS row to the UCR Part 1
// definition so the per-100k we display lines up with what the FBI's
// CDE publishes for the same city.
//
// Designed to match offense descriptions from MANY adapter formats —
// LAPD NIBRS ("242 - PC - M - Battery On Person - Simple - 13B"),
// SDPD NIBRS ("MURDER & NONNEGLIGENT MANSLAUGHTER"), Cincinnati STARS
// ("Aggravated Assault"), etc. Erring on the side of inclusion when
// ambiguous — better to overcount slightly than miss a Part 1 crime.

// Hard EXCLUDES — these are NIBRS Crimes Against Persons but NOT UCR
// Part 1. The default for a PERSONS-classified row is INCLUDE unless
// one of these matches (the original include-only approach failed
// because adapters publish generic descriptors like "ASSAULT" or
// "BATTERY" that don't carry the "aggravated"/"simple" qualifier).
// LAPD NIBRS rows do carry it ("Battery On Person - Simple - 13B")
// and we catch those via /\bsimple\b/i.
const PART1_VIOLENT_EXCLUDE = [
  /\bsimple\b/i,            // SDPD "SIMPLE ASSAULT", LAPD "...Simple..."
  /misdemeanor/i,
  /\bintimidation\b/i,
  /\bharassment\b/i,
  /\bharrassment\b/i,       // NYPD misspells this in their offense feed
  /\bstrangulation\b/i,
  /\bmenacing\b/i,
  /\bstalking\b/i,
  /human traffick/i,
  /kidnap/i,
  /\babduct/i,
  // Philadelphia (CARTO) emits "Other Assaults" for simple
  // assault — half a million rows that pushed Philly's PERSONS
  // rate to 3.3× the FBI Part-1 baseline. NIBRS jurisdictions
  // also emit "OTHER ASSAULT" and "OTHER OFFENSE" variants.
  /\bother assault/i,
  /\bother offense/i,
  // NOLA emits BATTERY for simple physical contact — only
  // BATTERY-AGGRAVATED is Part 1. The "aggravated" qualifier
  // is checked further down via /aggravated/ — bare BATTERY
  // is simple and should be excluded.
  /^battery$/i,
  /^\s*battery\b(?!.*aggrav)/i,
  /false imprisonment/i,
  /\bextortion\b/i,
  /coercion/i,
  /weapons.*offense/i,      // weapon-law violations are NIBRS Society
  /weapon law/i,
  /child abuse/i,
  /child neglect/i,
  /elder abuse/i,
  /family offense/i,
  /\bdomestic\b(?!.*assault).*$/i, // DV w/o assault → catch-all
];

// Hard EXCLUDES for property — NIBRS classifies these as Crimes
// Against Property but FBI UCR Part 1 property is only burglary,
// larceny, MV theft, arson.
const PART1_PROPERTY_EXCLUDE = [
  /vandal/i,
  /destruction.*property/i,
  /damage.*property/i,
  /criminal mischief/i,
  /\bfraud\b/i,
  /forgery/i,
  /counterfeit/i,
  /identity theft/i,
  /credit card/i,
  /embezzle/i,
  /false pretenses/i,
  /\bstolen property\b/i,
  /receiving.*stolen/i,
  /\bextortion\b/i,
  /\bbribery\b/i,
];

// Default-INCLUDE filter: trust the adapter's NIBRS classification
// and only exclude offenses that NIBRS-broad-classifies as
// PERSONS/PROPERTY but UCR-Part-1 doesn't. This is more forgiving
// of generic offense descriptions like "ASSAULT" / "BATTERY" /
// "THEFT" that lack the modifier specifying aggravated-vs-simple.
function isPart1Violent(desc: string | undefined): boolean {
  if (!desc) return true; // unknown description → trust NIBRS PERSONS, count
  for (const ex of PART1_VIOLENT_EXCLUDE) if (ex.test(desc)) return false;
  return true;
}

function isPart1Property(desc: string | undefined): boolean {
  if (!desc) return true;
  for (const ex of PART1_PROPERTY_EXCLUDE) if (ex.test(desc)) return false;
  return true;
}

/// Compute a confidence signal for the score. A small/short data window
/// produces a per-capita rate that can swing wildly even when the city's
/// actual crime profile is steady (annualizing a 14-day sample from a
/// slow upstream day flips grades). We expose three buckets:
///   - "low"    : window too short OR rate implausibly low for the city size
///   - "medium" : window short of the ideal 90+ days OR rate notably low
///   - "high"   : enough data + plausible rate
/// `note` is a UI-ready sentence the score card can render verbatim when
/// confidence < "high". Returning a structured note (rather than building
/// it client-side) keeps the API the single source of truth.
function computeDataConfidence(
  windowDays: number,
  totalIncidents: number,
  pop: number,
  // CFS-calibration scale (Cleveland 0.35 / NOLA 0.40 / LV 0.50, else 1.0).
  // Without this, the ratio check for CFS cities sees raw calls-for-service
  // counts which are structurally 2-3× inflated vs NIBRS, so the "low
  // confidence" tripwire never fires for them even when data is genuinely
  // thin — the audit caught this drift.
  cfsScale: number = 1,
): { dataConfidence: SafetyScoreResponse["dataConfidence"]; dataConfidenceNote?: string } {
  if (windowDays === 0 || totalIncidents === 0) {
    return {
      dataConfidence: "low",
      dataConfidenceNote:
        "No incidents are in the cached window — the upstream feed may be temporarily unavailable. Grade is shown for shape only.",
    };
  }
  if (windowDays < 30) {
    return {
      dataConfidence: "low",
      dataConfidenceNote:
        `Score reflects only ~${windowDays} days of data, which is short of the 90+ days needed for a stable comparison. The grade may shift when the feed refreshes.`,
    };
  }
  // Annualized observed rate vs combined FBI national (persons + property).
  // For CFS-calibrated cities, apply the same scale we apply to the rates
  // shown to users; otherwise the ratio is on a different yardstick from
  // the national reference.
  const nationalCombined = FBI_NATIONAL_PER_100K_2024.PERSONS + FBI_NATIONAL_PER_100K_2024.PROPERTY;
  const observedAnnual = pop > 0
    ? (totalIncidents * (365 / windowDays) / pop) * 100_000 * cfsScale
    : 0;
  const ratio = nationalCombined > 0 ? observedAnnual / nationalCombined : 1;
  // Major cities (>500k) almost never run < 25% of the FBI national rate;
  // that ratio is the signature of a partial upstream pull.
  if (pop > 500_000 && ratio < 0.25) {
    return {
      dataConfidence: "low",
      dataConfidenceNote:
        "The reported per-capita rate is much lower than expected for a city this size, suggesting the upstream feed is currently serving partial data. Grade may shift when the feed refreshes.",
    };
  }
  if (windowDays < 90 || (pop > 200_000 && ratio < 0.5)) {
    return {
      dataConfidence: "medium",
      dataConfidenceNote:
        `Based on a ~${windowDays}-day data window — read the grade as provisional. When the upstream feed refreshes, the longer window will tighten the comparison.`,
    };
  }
  return { dataConfidence: "high" };
}

/// Grade a per-area row set by the AREA's rate vs the CITY's rate
/// (averaged across the two reported categories). Thresholds are wider
/// than the prior vs-national thresholds because within-city variance
/// is naturally larger — a quiet residential neighborhood can sit at
/// 0.3× the city rate, a downtown core often runs 2–4× the city rate,
/// and both are honest reflections of "this area vs its peer cities".
function gradeFromCityDeltas(rows: SafetyScoreRow[]): SafetyScoreResponse["grade"] {
  const ratios = rows.map((r) => r.cityPer100k > 0 ? r.localPer100k / r.cityPer100k : 1);
  if (ratios.length === 0) return "C";
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  if (avg <= 0.5)  return "A"; // ≥50% below city average
  if (avg <= 0.8)  return "B"; // 20–50% below
  if (avg <= 1.4)  return "C"; // within ±40% of city average
  if (avg <= 2.5)  return "D"; // 1.4–2.5× city average
  return "E";                  // >2.5× city average
}

/// Grade the CITYWIDE rate vs the FBI NATIONAL rate. Legacy fallback —
/// used only when we don't have a city-specific FBI baseline. Most
/// urban cities collapse to D/E under this because national includes
/// rural + suburban areas.
function gradeFromNationalDeltas(rows: SafetyScoreRow[]): SafetyScoreResponse["grade"] {
  const ratios = rows.map((r) => r.nationalPer100k > 0 ? r.localPer100k / r.nationalPer100k : 1);
  if (ratios.length === 0) return "C";
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  if (avg <= 0.6) return "A";
  if (avg <= 0.9) return "B";
  if (avg <= 1.3) return "C";
  if (avg <= 2.0) return "D";
  return "E";
}

/// Grade the CITYWIDE rate vs the city's OWN FBI-published rate. This
/// is the authoritative comparison: "is the current adapter sample
/// reading above or below what the FBI published as this city's
/// canonical per-100k rate?" Grades are tighter than the legacy
/// vs-national ladder because city-vs-its-own-baseline ratios cluster
/// around 1.0 (a healthy adapter on a stable-crime city should match
/// the FBI baseline within ~20%). Big deviations point to either a
/// genuine spike or adapter inflation — both are meaningful signals.
function gradeFromCityFbiBaseline(
  rows: SafetyScoreRow[],
  baseline: { violent: number; property: number },
): SafetyScoreResponse["grade"] {
  const personsRow = rows.find((r) => r.category === "PERSONS");
  const propertyRow = rows.find((r) => r.category === "PROPERTY");
  const ratios: number[] = [];
  if (personsRow && baseline.violent > 0) ratios.push(personsRow.localPer100k / baseline.violent);
  if (propertyRow && baseline.property > 0) ratios.push(propertyRow.localPer100k / baseline.property);
  if (ratios.length === 0) return "C";
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  if (avg <= 0.7) return "A";  // ≥30% below city's baseline — meaningfully quieter
  if (avg <= 0.9) return "B";  // 10-30% below
  if (avg <= 1.2) return "C";  // within ±20% — matches baseline
  if (avg <= 1.6) return "D";  // 20-60% above
  return "E";                   // >60% above (or adapter is over-counting)
}

function headlineForArea(grade: SafetyScoreResponse["grade"], areaLabel: string, cityLabel: string): string {
  switch (grade) {
    case "A": return `${areaLabel} reports lower per-capita rates than ${cityLabel} citywide.`;
    case "B": return `${areaLabel} reports below ${cityLabel}'s citywide rate.`;
    case "C": return `${areaLabel} reports close to ${cityLabel}'s citywide rate.`;
    case "D": return `${areaLabel} reports higher per-capita rates than ${cityLabel} citywide. Use the cards below to see which category drives the gap.`;
    case "E": return `${areaLabel} reports notably higher per-capita rates than ${cityLabel} citywide. Use the Awareness tab for the offense mix.`;
    case "N/A": return `We don't have recent data for ${areaLabel} right now. The ${cityLabel} feed may be temporarily unavailable — check Coverage for live status.`;
  }
}

function headlineForCity(grade: SafetyScoreResponse["grade"], cityLabel: string): string {
  switch (grade) {
    case "A": return `${cityLabel} reports lower per-capita rates than the FBI national average.`;
    case "B": return `${cityLabel} reports below the FBI national rate.`;
    case "C": return `${cityLabel} reports close to the FBI national rate.`;
    case "D": return `${cityLabel} reports higher per-capita rates than the FBI national average. Use the cards below to see which category drives the gap.`;
    case "E": return `${cityLabel} reports notably higher per-capita rates than the FBI national average.`;
    case "N/A": return `We don't have recent data for ${cityLabel} right now. The upstream feed may be temporarily unavailable — check Coverage for live status.`;
  }
}

// Detect the "data unavailable" case the audit caught. When counts are
// zero AND the confidence pipeline already flagged low confidence with
// a note, we shouldn't slap an A-E grade on the area — the grade math
// collapses to a meaningless "near average" C, which is the LA
// regression the audit surfaced. Return "N/A" so the UI can render
// "data unavailable" instead of a misleading letter.
function gradeWithNullGuard(
  derivedGrade: SafetyScoreResponse["grade"],
  totalCount: number,
  confidence: SafetyScoreResponse["dataConfidence"],
): SafetyScoreResponse["grade"] {
  if (totalCount === 0 && confidence === "low") return "N/A";
  return derivedGrade;
}

// Round windowDays to the nearest 7-day boundary so a small drift in
// the adapter's oldest cached row (a hours-level shift between cache
// refresh cycles) doesn't change the annualization divisor at all.
// The audit caught San Diego drifting 141 → 143 over 8 minutes — a
// 1.4% rate move with no real-world change. Rounded windowDays
// absorbs that drift while preserving the annualization signal.
// For very sparse caches (<14 days), keep the actual value so we
// don't false-claim a full week's coverage.
function roundWindowDays(raw: number): number {
  if (raw < 14) return raw;
  return Math.round(raw / 7) * 7;
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
  let latest = 0;
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

  // ─── STABILITY FIX ──────────────────────────────────────────────────
  // Previously the rate window was [datasetLatest - 365d, datasetLatest]
  // and windowDays was derived from the min/max of in-window rows.
  // Both endpoints were data-derived; tiny shifts in adapter caches
  // (a single newer row coming in, a row at the cutoff dropping out)
  // produced dramatic per-refresh rate swings. For adapters with
  // sparse caches like NYC ($limit=50000 covers only ~3 days of data),
  // a one-day shift in the newest row drove the 365/windowDays
  // annualization factor from ~120× to ~180× — a 50% rate swing
  // on identical user actions. Users (correctly) read this as
  // unreliable data.
  //
  // The fix: anchor BOTH bounds to wall-clock, derive windowDays from
  // the adapter's characteristic data span (oldest row), capped at
  // 365. Clock anchors don't drift between refreshes; the adapter's
  // oldest row drifts by hours per refresh, not multiples.
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const RATE_WINDOW_DAYS = 365;
  const nowMs = Date.now();
  const windowStartMs = nowMs - RATE_WINDOW_DAYS * MS_PER_DAY;

  // Step 1: find the oldest valid row across the FULL adapter response
  // (not just in-window). This is the characteristic data span the
  // adapter pagination yields. Used purely to drive windowDays — does
  // NOT affect which rows we count.
  let dataEarliestMs = nowMs;
  for (const incidents of perArea) {
    for (const i of incidents) {
      const t = +new Date(i.occurredAt);
      if (!Number.isFinite(t) || t <= 0 || t > nowMs) continue;
      if (t < dataEarliestMs) dataEarliestMs = t;
    }
  }

  // Step 2: count incidents strictly in [windowStartMs, nowMs] AND
  // strictly within UCR Part 1 violent/property. The Part 1 filter is
  // applied on top of the adapter's NIBRS classification — see
  // isPart1Violent/isPart1Property above. Without it, the per-100k
  // we display runs 2-7× the FBI's published city rate because
  // adapters lump simple assault + intimidation under NIBRS "Crimes
  // Against Persons" which is broader than UCR Part 1 violent.
  //
  // Also track which AREAS contributed at least one in-window
  // incident so the population denominator can be limited to the
  // "fresh-data" subset of the city (DC/KC stale-adapter fix).
  const freshAreaSlugs = new Set<string>();
  for (let a = 0; a < areas.length; a++) {
    const incidents = perArea[a];
    let contributed = false;
    for (const i of incidents) {
      const t = +new Date(i.occurredAt);
      if (!Number.isFinite(t) || t <= 0) continue;
      if (t < windowStartMs || t > nowMs) continue;
      const k = i.nibrsCategory as "PERSONS" | "PROPERTY" | "SOCIETY";
      const desc = i.ibrOffenseDescription;
      let counted = false;
      if (k === "PERSONS" && isPart1Violent(desc)) { persons += 1; counted = true; }
      else if (k === "PROPERTY" && isPart1Property(desc)) { property += 1; counted = true; }
      if (counted) {
        contributed = true;
        if (t > latest) latest = t;
      }
    }
    if (contributed) freshAreaSlugs.add(areas[a].slug);
  }

  // Step 3: windowDays = the LESSER of 365 (the cap) and the adapter's
  // actual coverage (now - oldest row). For NYC/Chicago/sparse caches
  // this gives the honest annualization. For Charlotte / MPLS / KC
  // with multi-year caches this clamps to 365 (which means annualization
  // is the identity — count IS the annual rate). Stable across refreshes
  // because dataEarliestMs barely moves between cache cycles.
  // Rounded to a 7-day boundary to absorb sub-day cache drift; see
  // roundWindowDays for the rationale.
  const rawWindowDays = dataEarliestMs < nowMs
    ? Math.min(RATE_WINDOW_DAYS, Math.max(1, Math.round((nowMs - dataEarliestMs) / MS_PER_DAY)))
    : 0;
  const windowDays = roundWindowDays(rawWindowDays);
  // FRESH-DATA DENOMINATOR. Sum the populations of only the areas
  // that contributed at least one in-window incident. When every
  // tracked area is fresh (the normal case) this sums to approximately
  // cityPop. When ~half a city's adapter coverage is stale (DC/KC
  // pattern, where some neighborhoods publish recent reports and
  // others haven't been updated in months), this scales the
  // denominator with the numerator so the per-100k rate isn't
  // artificially deflated.
  //
  // If freshPopSum is implausibly small (no curated/generated pop
  // for any fresh area), we fall back to cityPop so we never divide
  // by ~0. The gradeWithNullGuard downstream still catches the
  // genuine no-data case (persons + property === 0) and emits N/A
  // instead of a misleading "A".
  let freshPopSum = 0;
  for (const a of areas) {
    if (!freshAreaSlugs.has(a.slug)) continue;
    const known = knownNeighborhoodPopulation(city.slug, a.slug);
    if (known) freshPopSum += known.population;
  }
  const popFraction = cityPop > 0 ? freshPopSum / cityPop : 0;
  // Clamp: if fresh-area pop is implausibly small (< 10% of city)
  // OR we couldn't resolve any per-area pops, use cityPop as a safe
  // fallback. Otherwise use the fresh subset.
  const pop = (popFraction >= 0.10 && freshPopSum > 0) ? freshPopSum : cityPop;
  // CFS calibration — see CFS_CALIBRATION comment at the top of the file.
  // 1.0 for NIBRS-based adapters, ~0.35-0.50 for CFS-based.
  const cfsScale = CFS_CALIBRATION[city.slug] ?? 1.0;
  const annualize = (count: number) => {
    if (pop <= 0 || windowDays <= 0) return 0;
    const annualCount = count * (365 / windowDays);
    return (annualCount / pop) * 100_000 * cfsScale;
  };

  // For the citywide endpoint the area IS the city, so cityPer100k =
  // localPer100k and cityDeltaPct = 0 by definition. The shape stays
  // consistent with the per-area endpoint so consumers can read either
  // through one branch.
  const personsLocal100k = Math.round(annualize(persons));
  const propertyLocal100k = Math.round(annualize(property));
  const rows: SafetyScoreRow[] = [
    {
      category: "PERSONS",
      count: persons,
      localPer100k: personsLocal100k,
      cityPer100k: personsLocal100k,
      cityDeltaPct: 0,
      nationalPer100k: FBI_NATIONAL_PER_100K_2024.PERSONS,
      deltaPct: FBI_NATIONAL_PER_100K_2024.PERSONS === 0 ? 0
        : Math.round(((personsLocal100k - FBI_NATIONAL_PER_100K_2024.PERSONS) / FBI_NATIONAL_PER_100K_2024.PERSONS) * 100),
    },
    {
      category: "PROPERTY",
      count: property,
      localPer100k: propertyLocal100k,
      cityPer100k: propertyLocal100k,
      cityDeltaPct: 0,
      nationalPer100k: FBI_NATIONAL_PER_100K_2024.PROPERTY,
      deltaPct: FBI_NATIONAL_PER_100K_2024.PROPERTY === 0 ? 0
        : Math.round(((propertyLocal100k - FBI_NATIONAL_PER_100K_2024.PROPERTY) / FBI_NATIONAL_PER_100K_2024.PROPERTY) * 100),
    },
  ];

  // Citywide grading anchor: prefer the city's OWN FBI-published rate
  // when we have it baked in city-fbi-baselines-generated.ts. That's
  // the authoritative comparison — "is the current adapter sample
  // reading above or below what the FBI says this city's canonical
  // rate is?" — and gives a much more honest grade than comparing
  // adapter-derived rates against the FBI national average, which
  // is structurally pulled down by rural areas and made every urban
  // city land at D/E regardless of whether the period was actually
  // representative.
  //
  // When no FBI city baseline is on file (Denver, Cambridge,
  // Charlotte, Nashville, Minneapolis, Las Vegas, Tucson — ORI
  // lookup pending), fall back to the legacy vs-national grader.
  const cityLabel = `${city.label} (citywide)`;
  let confidence = computeDataConfidence(windowDays, persons + property, pop, cfsScale);
  const fbiBaseline = CITY_FBI_BASELINES[city.slug];
  const rawGrade = fbiBaseline
    ? gradeFromCityFbiBaseline(rows, fbiBaseline)
    : gradeFromNationalDeltas(rows);
  let grade = gradeWithNullGuard(rawGrade, persons + property, confidence.dataConfidence);

  // Calibration divergence guard (v25 audit fix). The score audit
  // caught several cities reporting an A or B grade despite being
  // among the highest-crime cities in the US — root cause: the
  // adapter's annualized rate diverges from the FBI baseline by 3×
  // or more in EITHER direction (under-count from a narrow Part-1
  // filter, over-count from CFS data with the wrong calibration
  // factor, or missing pop/window data). In those cases we refuse
  // to assign a letter grade and surface a clear "calibration in
  // progress" note instead of telling a Detroit user "Grade A".
  if (fbiBaseline) {
    const personsRow = rows.find((r) => r.category === "PERSONS");
    const propertyRow = rows.find((r) => r.category === "PROPERTY");
    const divergence: number[] = [];
    if (personsRow && fbiBaseline.violent > 0 && personsRow.localPer100k > 0) {
      divergence.push(personsRow.localPer100k / fbiBaseline.violent);
    }
    if (propertyRow && fbiBaseline.property > 0 && propertyRow.localPer100k > 0) {
      divergence.push(propertyRow.localPer100k / fbiBaseline.property);
    }
    const worst = divergence.length > 0
      ? Math.max(...divergence.map((d) => d > 1 ? d : 1 / d))
      : 1;
    if (worst >= 3) {
      grade = "N/A";
      confidence = {
        ...confidence,
        dataConfidence: "low",
        dataConfidenceNote:
          `${city.label}'s adapter rate diverges ${worst.toFixed(1)}× from the FBI ${fbiBaseline.year} ` +
          `published baseline. Likely causes: narrow Part-1 filter, ` +
          `wrong CFS calibration, or a population denominator mismatch. ` +
          `Grade is suppressed to avoid misleading users until the ` +
          `calibration lands.`,
      };
    }
  }

  const headline = headlineForCity(grade, cityLabel);

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
      `${city.label}'s US Census Bureau Vintage 2024 population (${pop.toLocaleString()}). ` +
      (fbiBaseline
        ? `The grade compares this rate against ${city.label}'s OWN FBI-published rate for ${fbiBaseline.year} ` +
          `(violent ${fbiBaseline.violent}/100k, property ${fbiBaseline.property}/100k via cde.ucr.cjis.gov agency ORI ${fbiBaseline.ori}). ` +
          `A grade of A means the current adapter sample is ≥30% below that baseline; ` +
          `C means within ±20% of it; E means ≥60% above (a real spike or adapter over-count). `
        : `The grade compares this rate against the FBI ${FBI_NATIONAL_SOURCE.publishedYear} national average ` +
          `because no city-specific FBI baseline is on file for ${city.label} yet. `) +
      "Society / public-order offenses are excluded because the FBI does not publish a national rate." +
      (CFS_CALIBRATION[city.slug]
        ? ` ${city.label} publishes calls-for-service rather than closed NIBRS reports; rates are scaled by ${CFS_CALIBRATION[city.slug]}× to approximate NIBRS-equivalent volumes (CFS is structurally 2–3× inflated because each crime spawns multiple dispatches and many dispatches are unfounded).`
        : ""),
    ...confidence,
    dataSourceType: CFS_CALIBRATION[city.slug] ? "cfs" : "nibrs",
    cfsScale: CFS_CALIBRATION[city.slug] ?? 1.0,
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

  // Same rate-window cap as getCitywideSafetyScore — see comment there.
  // Find the dataset's newest timestamp first; only rows within the last
  // 365 days from that anchor count toward citywide totals and area
  // counts. Without this, adapters that publish multi-year datasets
  // (Charlotte at 54 years, MPLS at 22 years) annualize over the full
  // span and produce ~1/N of the real annual rate.
  // ─── STABILITY FIX (per-area variant) ─────────────────────────────
  // Same approach as getCitywideSafetyScore — anchor the rate window
  // to wall-clock instead of the per-call observed min/max. See
  // citywide function's comment for full rationale; the per-area
  // variant amplifies the issue because per-area counts are smaller
  // and noisier, so windowDays swings cascade into bigger rate swings.
  const PER_AREA_MS_PER_DAY = 24 * 60 * 60 * 1000;
  const PER_AREA_RATE_WINDOW_DAYS = 365;
  const nowMsArea = Date.now();
  const windowStartMsArea = nowMsArea - PER_AREA_RATE_WINDOW_DAYS * PER_AREA_MS_PER_DAY;

  // Oldest row across the FULL response — drives windowDays only.
  let dataEarliestMsArea = nowMsArea;
  for (const arr of incidentsPerArea) {
    for (const i of arr) {
      const t = +new Date(i.occurredAt);
      if (!Number.isFinite(t) || t <= 0 || t > nowMsArea) continue;
      if (t < dataEarliestMsArea) dataEarliestMsArea = t;
    }
  }

  // Citywide totals across every tracked neighborhood, within the
  // CLOCK-anchored window.
  let cityPersons = 0, cityProperty = 0;
  let latest = 0;
  for (const arr of incidentsPerArea) {
    for (const i of arr) {
      const t = +new Date(i.occurredAt);
      if (!Number.isFinite(t) || t <= 0) continue;
      if (t < windowStartMsArea || t > nowMsArea) continue;
      const k = i.nibrsCategory as "PERSONS" | "PROPERTY" | "SOCIETY";
      const desc = i.ibrOffenseDescription;
      // Apply UCR Part 1 filter — see helper functions for rationale.
      if (k === "PERSONS" && isPart1Violent(desc)) cityPersons += 1;
      else if (k === "PROPERTY" && isPart1Property(desc)) cityProperty += 1;
      if (t > latest) latest = t;
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

  // Per-area count uses the SAME clock-anchored window AND UCR
  // Part 1 filter so it's apples-to-apples with the citywide totals
  // computed above.
  let persons = 0, property = 0;
  for (const i of areaIncidents) {
    const t = +new Date(i.occurredAt);
    if (!Number.isFinite(t) || t <= 0) continue;
    if (t < windowStartMsArea || t > nowMsArea) continue;
    const k = i.nibrsCategory as "PERSONS" | "PROPERTY" | "SOCIETY";
    const desc = i.ibrOffenseDescription;
    if (k === "PERSONS" && isPart1Violent(desc)) persons += 1;
    else if (k === "PROPERTY" && isPart1Property(desc)) property += 1;
  }

  // windowDays from clock + adapter's oldest row (same stable formula
  // as the citywide variant). The per-area count above shares this
  // window via the per-area incident loop. Rounded to a 7-day boundary
  // to absorb sub-day cache drift; see roundWindowDays for rationale.
  const rawWindowDays = dataEarliestMsArea < nowMsArea
    ? Math.min(PER_AREA_RATE_WINDOW_DAYS, Math.max(1, Math.round((nowMsArea - dataEarliestMsArea) / PER_AREA_MS_PER_DAY)))
    : 0;
  const windowDays = roundWindowDays(rawWindowDays);

  // Citywide annualized rate per 100k — uses the actual US Census Vintage
  // 2024 city population. Same CFS calibration as getCitywideSafetyScore
  // so per-area scores are comparable to the citywide grade.
  const cfsScalePerArea = CFS_CALIBRATION[city.slug] ?? 1.0;
  const annualizeCity = (count: number) => {
    if (cityPop <= 0 || windowDays <= 0) return 0;
    return (count * 365 / windowDays / cityPop) * 100_000 * cfsScalePerArea;
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
  // Peer-share baseline used either as the primary estimator (no
  // polygon) OR as a floor when polygon-weighting produces an
  // implausibly low population for dense neighborhoods.
  const peerSharePop = cityPop > 0 ? cityPop / N : 0;
  // POPULATION ESTIMATION — three tiers, most-accurate first:
  //
  //   1. Curated override (SANDAG / Census ACS) keyed by city slug
  //      + area slug. Authoritative when present; bypasses both
  //      polygon weighting and peer-share. See
  //      neighborhood-population.ts for the seed list and sources.
  //
  //   2. Polygon-area weighting with a DENSITY-BIAS FLOOR. The
  //      polygon formula assumes uniform density across the city
  //      and breaks for denser-than-average neighborhoods; the floor
  //      `max(polygon, peer-share)` prevents the polygon from
  //      DECREASING the estimate below the city's per-neighborhood
  //      average. Used when no curated entry exists AND a polygon
  //      is available.
  //
  //   3. Peer-share (cityPop / N areas). Final fallback when no
  //      curated entry AND no polygon is available.
  const curatedPop = knownNeighborhoodPopulation(city.slug, areaSlug);
  if (curatedPop) {
    popDenominator = curatedPop.population;
    const localPersonsRate = popDenominator > 0 ? (persons * 365 / Math.max(1, windowDays) / popDenominator) * 100_000 * cfsScalePerArea : 0;
    const localPropertyRate = popDenominator > 0 ? (property * 365 / Math.max(1, windowDays) / popDenominator) * 100_000 * cfsScalePerArea : 0;
    personsScale = cityPersons100k > 0 ? localPersonsRate / cityPersons100k : 0;
    propertyScale = cityProperty100k > 0 ? localPropertyRate / cityProperty100k : 0;
  } else if (ourAreaKm2 != null && cityTotalKm2 > 0 && cityPop > 0) {
    const polygonAreaPop = cityPop * (ourAreaKm2 / cityTotalKm2);
    const areaPop = Math.max(polygonAreaPop, peerSharePop);
    popDenominator = Math.round(areaPop);
    // Apply CFS scaling here too — otherwise (raw_local / scaled_city)
    // ratio cancels the scaling out and per-area persons100k ends up
    // unscaled while citywide rates are scaled.
    const localPersonsRate = areaPop > 0 ? (persons * 365 / Math.max(1, windowDays) / areaPop) * 100_000 * cfsScalePerArea : 0;
    const localPropertyRate = areaPop > 0 ? (property * 365 / Math.max(1, windowDays) / areaPop) * 100_000 * cfsScalePerArea : 0;
    personsScale = cityPersons100k > 0 ? localPersonsRate / cityPersons100k : 0;
    propertyScale = cityProperty100k > 0 ? localPropertyRate / cityProperty100k : 0;
  } else {
    // Peer-share fallback (no polygon available, or polygon coverage
    // doesn't include this area's name).
    popDenominator = cityPop > 0 ? Math.round(peerSharePop) : 0;
    const expectedPersons = cityPersons / N;
    const expectedProperty = cityProperty / N;
    personsScale = expectedPersons > 0 ? persons / expectedPersons : 0;
    propertyScale = expectedProperty > 0 ? property / expectedProperty : 0;
  }
  const persons100k = Math.round(cityPersons100k * personsScale);
  const property100k = Math.round(cityProperty100k * propertyScale);

  // City-rate baselines (already computed above as cityPersons100k /
  // cityProperty100k). These become the PRIMARY comparison anchor for
  // per-area scores — comparing a neighborhood to its own city's rate
  // is the "nearest available official baseline" and produces a
  // deviation users can act on. National stays in the response as a
  // secondary reference.
  const cityPersonsRounded = Math.round(cityPersons100k);
  const cityPropertyRounded = Math.round(cityProperty100k);
  const rows: SafetyScoreRow[] = [
    {
      category: "PERSONS",
      count: persons,
      localPer100k: persons100k,
      cityPer100k: cityPersonsRounded,
      cityDeltaPct: cityPersonsRounded > 0
        ? Math.round(((persons100k - cityPersonsRounded) / cityPersonsRounded) * 100)
        : 0,
      nationalPer100k: FBI_NATIONAL_PER_100K_2024.PERSONS,
      deltaPct: FBI_NATIONAL_PER_100K_2024.PERSONS === 0 ? 0
        : Math.round(((persons100k - FBI_NATIONAL_PER_100K_2024.PERSONS) / FBI_NATIONAL_PER_100K_2024.PERSONS) * 100),
    },
    {
      category: "PROPERTY",
      count: property,
      localPer100k: property100k,
      cityPer100k: cityPropertyRounded,
      cityDeltaPct: cityPropertyRounded > 0
        ? Math.round(((property100k - cityPropertyRounded) / cityPropertyRounded) * 100)
        : 0,
      nationalPer100k: FBI_NATIONAL_PER_100K_2024.PROPERTY,
      deltaPct: FBI_NATIONAL_PER_100K_2024.PROPERTY === 0 ? 0
        : Math.round(((property100k - FBI_NATIONAL_PER_100K_2024.PROPERTY) / FBI_NATIONAL_PER_100K_2024.PROPERTY) * 100),
    },
  ];

  // True when polygon weighting drove the population estimate (i.e.,
  // polygon-pop was already at or above the peer-share floor). False
  // when the density-bias floor kicked in OR no polygon was
  // available. The disclaimer reflects which model actually shaped
  // the score so users know whether the per-area population came
  // from geometry, peer-averaging, or the floor.
  const polygonAreaPopForDisclaimer = (ourAreaKm2 != null && cityTotalKm2 > 0 && cityPop > 0)
    ? cityPop * (ourAreaKm2 / cityTotalKm2)
    : 0;
  const usedPolygonWeight = ourAreaKm2 != null && cityTotalKm2 > 0 && cityPop > 0
    && polygonAreaPopForDisclaimer >= peerSharePop;
  // Confidence uses the per-area POP denominator (popDenominator). When
  // we couldn't estimate it (no polygon, no peer-share basis), volume-vs-
  // population doesn't carry a stable signal so we fall back to a window-
  // only heuristic via computeDataConfidence's first branches.
  // Computed before the grade so gradeWithNullGuard can demote a
  // no-data area to "N/A" instead of the misleading C the raw math
  // would yield.
  const confidence = computeDataConfidence(windowDays, persons + property, popDenominator, cfsScalePerArea);

  // Per-area grade compares to the CITY rate, not the national rate.
  // See gradeFromCityDeltas comment for the rationale.
  const grade = gradeWithNullGuard(
    gradeFromCityDeltas(rows),
    persons + property,
    confidence.dataConfidence,
  );
  const headline = headlineForArea(grade, areaLabel, city.label);
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
    disclaimer: curatedPop
      ? `Per-area rate uses a curated population estimate of ${curatedPop.population.toLocaleString()} ` +
        `residents for ${areaLabel} (source: ${curatedPop.source}) — bypasses the polygon-area / peer-share ` +
        `heuristics for the most-trafficked neighborhoods so the per-capita rate matches the actual census ` +
        `population. The grade compares the result to ${city.label}'s OWN citywide rate (the nearest ` +
        `official baseline), not the FBI national average. ${city.label}'s citywide comparison vs ` +
        `the FBI ${FBI_NATIONAL_SOURCE.publishedYear} national rate is shown below for reference. ` +
        "Society / public-order offenses are excluded because the FBI doesn't publish a national rate for them."
      : usedPolygonWeight
      ? `Per-area rate uses this neighborhood's polygon area (${ourAreaKm2!.toFixed(1)} km²) ` +
        `to estimate population — assuming roughly uniform density across ${city.label}, an area ` +
        `gets a share of ${city.label}'s total population proportional to its share of the city's ` +
        `mapped area. The grade compares the result to ${city.label}'s OWN citywide rate (the nearest ` +
        `official baseline), not the FBI national average. ${city.label}'s citywide comparison vs ` +
        `the FBI ${FBI_NATIONAL_SOURCE.publishedYear} national rate is shown below for reference. ` +
        "Society / public-order offenses are excluded because the FBI doesn't publish a national rate for them."
      : `Per-area rate scales ${city.label}'s citywide per-100k rate by this neighborhood's ` +
        `share of recent reports relative to a typical ${city.label} neighborhood. A neighborhood ` +
        `reporting the average ${city.label} share lands at ${city.label}'s citywide rate; one ` +
        `reporting twice the share scales to 2× that rate. The grade compares the result to ` +
        `${city.label}'s OWN citywide rate (the nearest official baseline), not the FBI national average. ` +
        `${city.label}'s citywide vs FBI ${FBI_NATIONAL_SOURCE.publishedYear} national is shown below for context. ` +
        "Society / public-order offenses are excluded because the FBI doesn't publish a national rate for them.",
    ...confidence,
    dataSourceType: CFS_CALIBRATION[city.slug] ? "cfs" : "nibrs",
    cfsScale: CFS_CALIBRATION[city.slug] ?? 1.0,
  };
}
