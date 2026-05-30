import { crimeData } from "./dispatcher.js";
import { cityForArea } from "./cities.js";
import { loadPolygonAreas, lookupAreaKm2, totalCityKm2 } from "./polygon-areas.js";
import { HttpError } from "./errors.js";
import { knownNeighborhoodPopulation } from "./neighborhood-population.js";
import { CITY_FBI_BASELINES } from "./fbi-baselines.js";
import { dedupe } from "./lib/inflight.js";

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
import { CITY_POPULATION, POPULATION_VINTAGE } from "./population.js";

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
// v99 — PER-CATEGORY CFS calibration. CFS (calls-for-service) volume converts
// to NIBRS-equivalent volume at a DIFFERENT ratio for violent vs property: a
// single coarse "Violent Crimes" / "AssaultOffense" dispatch bucket is far more
// inflated than property dispatches. A single per-city scale tuned to tame the
// over-counting category collaterally crushed the other (Las Vegas property
// read 0.54× FBI, Boise property 0.48×, both purely from the single 0.50/0.20
// scale tuned for their over-counting violent bucket). Each category is now
// scaled independently so both land near the city's FBI baseline.
// sourceType: "cfs" = calls-for-service feed; "coarse" = NIBRS feed whose
// assault bucket has no simple-vs-aggravated severity field (Honolulu,
// Milwaukee); "partial" = feed PUBLISHES only a subset of a UCR category, so
// it structurally under-measures (Washington DC publishes only "assault with a
// dangerous weapon", missing the non-weapon aggravated assaults the FBI counts).
// In all three the violent rate can't be derived precisely from the feed and is
// instead calibrated to the FBI baseline in aggregate. Only "cfs" widens the
// divergence-guard threshold and shows the "calls-for-service" badge.
interface CfsScale { persons: number; property: number; sourceType: "cfs" | "coarse" | "partial"; }
const CFS_CALIBRATION: Record<string, CfsScale> = {
  // Cleveland REMOVED in v95p14. The Cleveland adapter switched from
  // CAD_Police (Calls for Service, dispatch-keyword-matched) to
  // Crime_Incidents_P1RMS (CDP's NIBRS Part-1 incident reports, with
  // IncidentDesc pre-classified by CDP). The 0.55 CFS scale was a
  // workaround for the keyword-matching imprecision; now that the
  // upstream itself pre-classifies to NIBRS Part-1, the rate is
  // directly comparable to the FBI baseline. No scale needed.
  // New Orleans 0.40 → 0.80 (v28). Same pattern as Cleveland —
  // 0.40 scaled NOPD's actual rate (~698/100k violent) down to
  // 279/100k, ~5× under the FBI baseline of 1361. 0.80 lands
  // violent at ~558/100k (0.41× baseline, Grade B-ish) and
  // property at ~4282/100k (0.84× baseline). Plausible signal,
  // inside the divergence guard.
  // v99 — persons 0.80→1.4. NOPD's calls-for-service feed, after Part-1 keyword
  // filtering, structurally UNDER-captures violent crime (it read 0.52× FBI even
  // after the 0.80 scale — misleadingly low for one of the highest-crime US
  // cities, baseline 1361). Unlike Las Vegas/Boise (CFS OVER-counts violent),
  // NOLA's CFS keyword filter misses violent calls coded generically, so the
  // persons scale compensates UP. Property (0.99×) is accurate → stays 0.80.
  "new-orleans":   { persons: 1.4, property: 0.80, sourceType: "cfs" },
  // v99 — Las Vegas split. Raw violent ran ~2.9× FBI (LVMPD CFS coarse),
  // raw property ~1.1×; the single 0.50 scale put property at 0.54×. Persons
  // 0.34 (→~1.0×), property 0.93 (→~1.0×).
  "las-vegas":     { persons: 0.34, property: 0.93, sourceType: "cfs" },
  // v68 followup — Boise 0.30 → 0.20. The grade-sanity worker flagged
  // PERSONS at 2.01× FBI city baseline even after the 0.30 scale —
  // BPD's "Violent Crimes" category label is too coarse for adapter-
  // side Part-1 filtering (one bucket spanning aggravated assault,
  // simple assault, intimidation, family disturbance, etc.). 0.20
  // brings violent into ~1.34× (still over but plausibly real —
  // Boise has elevated reporting). Property drops to ~0.48× which
  // is acceptable trade-off; per-category CFS scaling is a deeper
  // architectural change tracked separately.
  // v99 — Boise split. BPD's coarse "Violent Crimes" CFS bucket ran ~8× FBI
  // raw; property ~2.9×. The single 0.20 scale left violent ~1.6× over and
  // property at 0.48×. Persons 0.12 (→~1.0×), property 0.34 (→~1.0×).
  "boise":         { persons: 0.12, property: 0.34, sourceType: "cfs" },
  // v99 — COARSE-NIBRS over-counters (no severity field to split simple vs
  // aggravated assault). Honolulu HPD publishes a single coarse "ASSAULT"
  // type (Assault 1/2/3 combined, ~56% misdemeanor simple) with no statute /
  // charge / severity column anywhere in the feed; Milwaukee WIBR exposes a
  // single boolean AssaultOffense flag (13A+13B+13C) with only a weak
  // WeaponUsed proxy. Neither violent rate can be filtered to UCR Part-1
  // aggravated assault, so it's calibrated to the city's FBI baseline in
  // aggregate (persons ≈ 1 / observed-over-count). Property is accurate → 1.0.
  "honolulu":      { persons: 0.56, property: 1.0, sourceType: "coarse" },
  "milwaukee":     { persons: 0.53, property: 1.0, sourceType: "coarse" },
  // v99 — Washington DC publishes ONLY "ASSAULT W/DANGEROUS WEAPON" (weapon-
  // involved) in its open Crime Incidents feed; the FBI counts ALL aggravated
  // assaults (with OR without a weapon — DC files the rest as simple assault,
  // not published). Documented limitation (FactCheck.org / J. Asher): DC's ADW
  // ~932/yr captures only ~1/4 of the FBI aggravated-assault count, so the feed
  // understates violent crime ~2× (homicide + robbery are captured fully; the
  // gap is almost entirely the missing non-weapon aggravated assaults). No
  // public DC source has the missing rows, so calibrate the violent aggregate
  // to the FBI baseline (×2.1) and flag it. Property (~0.90×) is accurate → 1.0.
  "washington-dc": { persons: 2.1, property: 1.0, sourceType: "partial" },
  // v99 — Boston's open feed publishes NO rape/sexual-assault offense at all
  // (confirmed: 0 rape rows in 262k records, 2023-2026) — BPD suppresses it like
  // Cambridge. So the feed structurally caps at ~0.61× FBI (rape is ~7% of
  // violent and the FBI baseline includes it), and the recent-window slice reads
  // 0.47×. Aggravated assault + robbery + murder ARE captured and classified
  // correctly (simple assault excluded). Calibrate persons up (×1.4 → ~0.66×) to
  // approximate the FBI total incl. the missing rape, and flag it. Property
  // (1.43× after the tows/accidents exclude) is accurate-ish → 1.0.
  "boston":        { persons: 1.4, property: 1.0, sourceType: "partial" },
  // v100 — Long Beach. LBPD's public "Police Crime Mapping" feed under-
  // publishes Part-1 PROPERTY relative to the full FBI UCR submission: a
  // stable ~880 mapped property incidents/month (~10.5k/yr) vs the FBI's
  // 15.6k/yr, so property reads ~0.61× (NOT a reporting-lag artifact — the
  // monthly volume is flat Dec–Apr; petty larceny/theft simply isn't all
  // put on the public map). VIOLENT is accurate (626 vs 672 FBI = 0.93×;
  // robbery forced to PERSONS), so persons stays 1.0. Scale property ×1.64
  // to recover the authoritative FBI property rate and avoid false safety,
  // and flag it via the partial disclaimer.
  "long-beach":    { persons: 1.0, property: 1.64, sourceType: "partial" },
  // v100 — Dallas. The DPD public feed (qv6i-rri7) STRUCTURALLY REDACTS two big
  // slices of FBI violent crime: (1) rape / sex offenses — ZERO rows in the
  // person-crime feed (FBI Dallas ~480/yr); (2) family-violence aggravated
  // assault — only ~7 "AGG ASSAULT - FV" vs 558 "AGG ASSAULT - NFV" per 90d
  // (DV is redacted from public data). So the feed captures only NFV agg
  // assault + robbery + murder ≈ 0.55× the FBI violent total (8,698/yr) at the
  // corrected baseline (658). Same partial-feed pattern as Boston (missing
  // rape) / DC (weapon-only). Scale persons ×1.82 to recover the FBI aggregate;
  // property is genuinely high (Dallas auto theft) and accurate → stays 1.0.
  "dallas":        { persons: 1.82, property: 1.0, sourceType: "partial" },
  // v100 — Denver / Cambridge / Phoenix / Indianapolis cluster. FBI baselines
  // VERIFIED (4 aggregators): none too high — Denver/Phoenix were too low and
  // were raised (see fbi-baselines.ts). Each open feed then reads violent
  // ~0.51-0.61× over a FULL-YEAR window (not a volume/lag artifact), a genuine
  // structural under-capture: Denver + Cambridge publish ZERO rape rows
  // (confirmed), and all four under-report domestic-violence aggravated
  // assault (Indianapolis carries rape but still under-counts agg assault).
  // Same partial pattern as Dallas/Boston/DC — scale persons to the FBI total.
  // Property is accurate-ish (~0.78-0.91) → stays 1.0.
  "denver":        { persons: 1.95, property: 1.0, sourceType: "partial" },
  "cambridge":     { persons: 1.65, property: 1.0, sourceType: "partial" },
  "phoenix":       { persons: 1.79, property: 1.0, sourceType: "partial" },
  "indianapolis":  { persons: 1.64, property: 1.0, sourceType: "partial" },
};

/// Per-category rate-calibration lookup (1.0 for NIBRS adapters not in the
/// map). `isCfs` is true ONLY for true calls-for-service feeds — it widens the
/// divergence-guard threshold and drives the "calls-for-service" badge.
/// `sourceType` is "nibrs" when the slug isn't calibrated.
function cfsScalesFor(slug: string): { persons: number; property: number; isCfs: boolean; sourceType: "cfs" | "coarse" | "partial" | "nibrs" } {
  const c = CFS_CALIBRATION[slug];
  return { persons: c?.persons ?? 1, property: c?.property ?? 1, isCfs: c?.sourceType === "cfs", sourceType: c?.sourceType ?? "nibrs" };
}
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
  /// City's OWN FBI-published rate for this category (per
  /// CITY_FBI_BASELINES), or null if no per-city baseline is on file.
  /// BlockScoreWidget uses this as its citywide anchor so the score
  /// stays consistent with the letter grade (which has used this
  /// baseline since the city-FBI rebase). Without this field the
  /// score would compare to FBI national — making a city like NOLA
  /// look 2-3× worse than its grade suggests because national
  /// averages are pulled down by rural areas.
  cityFbiPer100k: number | null;
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
  // v68 — also catch the present-tense / non-noun forms. Las Vegas
  // emits "INTIMIDATE", "THREATEN", "THREATENING" which weren't being
  // caught by the noun-form patterns above. These were flooding LV's
  // PERSONS count and pushing the citywide ratio to 4.45× the FBI
  // city baseline (grade-sanity worker's biggest flagged outlier).
  /\bintimidate/i,
  /\bthreaten/i,
  // v68 followup — catch the noun "THREATS" (e.g. Cleveland CFS
  // "Threats Report - Susp on Scene") plus generic "FIGHT" (CFS
  // descriptor for verbal/non-injury altercations, not Part-1
  // aggravated assault). These slip past /threaten/ alone.
  /\bthreats\b/i,
  /\bfight\b/i,
  /\bharassment\b/i,
  /\bharass\b/i,
  /\bharrassment\b/i,       // NYPD misspells this in their offense feed
  /\bstrangulation\b/i,
  /\bmenacing\b/i,
  /\bstalking\b/i,
  /human traffick/i,
  /kidnap/i,
  /\babduct/i,
  // v68 — non-criminal disturbance dispatches that some CFS-flavored
  // adapters classify as PERSONS because they involve people:
  /family disturbance/i,
  /family trouble/i,
  /verbal dispute/i,
  /civil dispute/i,
  /\bdisturbance\b(?!.*assault)/i,
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
  // v99 — Nashville (MNPD) NIBRS 13B/13C descriptors that carry no generic
  // "simple"/"intimidation" token: "ASSAULT- FEAR OF BODILY INJURY" (13C
  // intimidation) and "ASSAULT- OFFENSIVE OR PROVOCATIVE CONTACT" (13B simple).
  // Neither is UCR Part-1 aggravated assault; they were being counted because
  // the adapter buckets all 13* as PERSONS and the deny-list found no token.
  // Genuine 13A "AGGRAVATED ASSAULT" is force-counted by the INCLUDE override.
  /fear of bodily injury/i,
  /offensive or provocative contact/i,
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
  // v99 — non-theft vehicle EVENTS that adapters classify PROPERTY via a
  // "motor vehicle" keyword but are NOT UCR Part-1 property (MV theft only).
  // Boston's "TOWED MOTOR VEHICLE" + "M/V ACCIDENT" pushed its property rate to
  // 1.94× FBI. ("M/V - LEAVING SCENE - PROPERTY DAMAGE" is already caught by
  // /damage.*property/.) Safe across cities — a tow/accident is never Part-1.
  /\btowed\b/i,
  /\baccident\b/i,
  // v100 — Boston's "M/V - LEAVING SCENE - PROPERTY DAMAGE" (~1.95k/yr) and
  // "TRESPASSING" (~160/yr) were counted as Part-1 property, pushing Boston's
  // property rate to 1.43× FBI. Neither is UCR Part-1 property (which is only
  // burglary / larceny-theft / MV-theft / arson). The reversed word order
  // "PROPERTY DAMAGE" slips past /damage.*property/, so match it directly.
  // Safe fleet-wide: a hit-and-run / trespass is never Part-1 property.
  /leaving scene/i,
  /property damage/i,
  /\btrespass/i,
  // v100 — Kansas City classifies traffic / hit-and-run events as PROPERTY
  // (its PROPERTY keys include "VEHICULAR"): "VEHICULAR - NON-INJURY",
  // "OCR - VEHICULAR NON-INJURY HIT AND RUN", "VEHICULAR - INJURY" (~400/window).
  // None are UCR Part-1 property (burglary / larceny / MV-theft / arson).
  // Safe fleet-wide — a traffic collision is never Part-1 property.
  /\bvehicular\b/i,
  /hit and run/i,
];

// Default-INCLUDE filter: trust the adapter's NIBRS classification
// and only exclude offenses that NIBRS-broad-classifies as
// PERSONS/PROPERTY but UCR-Part-1 doesn't. This is more forgiving
// of generic offense descriptions like "ASSAULT" / "BATTERY" /
// "THEFT" that lack the modifier specifying aggravated-vs-simple.
//
// v69 — memoize Part-1 results per unique description string. Cities
// typically have 50-200 unique offense descriptors but tens or
// hundreds of thousands of rows. Without memoization, the regex
// array (13+ patterns each) ran on every row — Phoenix (200k rows)
// did ~5.2M pattern tests per safety-score compute. The Map cache
// trims that to ~200 evaluations (one per unique desc). Caps the
// map at 5000 entries to bound memory in the pathological case
// where an adapter emits per-incident free-text descriptions.
const VIOLENT_CACHE = new Map<string, boolean>();
const PROPERTY_CACHE = new Map<string, boolean>();
const PART1_CACHE_CAP = 5000;

// v96 — module-level rate-compute constants (previously declared
// inside computeCitywideSafetyScore + getSafetyScore, duplicated).
// Hoisting them here gives the safety-score algorithm a single
// source of truth for the rate-window math and lets the constants
// carry their rationale in one place.

// v96p2 — was `export const MS_PER_DAY = 24 * 60 * 60 * 1000;` in
// this file plus four duplicates across trend-feed / upticks / mix /
// dispatcher. Centralized in lib/time-constants.ts. Imported here
// for internal use and re-exported so any external caller that was
// pulling MS_PER_DAY from safety-score keeps working.
import { MS_PER_DAY } from "./lib/time-constants.js";
export { MS_PER_DAY };

/// Annualization horizon for the citywide rate. We accept up to
/// 365 days of cached data; older rows are clamped because the
/// per-100k computation assumes 1-year exposure. Sparser adapters
/// (NYC with $limit=50000 covers ~3 days) get a much shorter
/// effective window; the algorithm trusts dataEarliestMs to scale
/// the annualization factor down accordingly.
export const RATE_WINDOW_DAYS = 365;

/// Same window applied at the per-area (rather than citywide) scale.
/// Kept separate so a future tweak can decouple area-level and
/// city-level windows if per-area sparsity becomes a problem.
export const PER_AREA_RATE_WINDOW_DAYS = 365;

/// Trim the oldest 5% of timestamps when computing dataEarliestMs.
/// Without this, a single ancient row (from an adapter that occasionally
/// surfaces backdated incidents) would set windowDays to 365+ and
/// inflate the annualization factor, slashing the per-100k rate. 5%
/// is small enough that legitimate dense data still drives the window,
/// large enough to absorb adapter outliers.
export const OLDEST_TIMESTAMP_TRIM_FRACTION = 0.05;

/// Minimum fraction of citywide population that must be in the
/// "fresh-data" subset before we use it as the rate denominator. Below
/// this threshold we fall back to cityPop so a non-representative
/// fresh subset (e.g., only high-crime neighborhoods reporting) can't
/// amplify the per-100k rate. Seattle prod showed 31% fresh coverage
/// at one point — v31 raised this from 0.10 to 0.70 after that
/// produced a 3× FBI-baseline rate.
export const FRESH_POP_FRACTION_THRESHOLD = 0.70;

// v95p1 — explicit Part-1 INCLUDES for unambiguous aggravated indicators
// that would otherwise be dropped by the EXCLUDE patterns. Cleveland's
// CFS feed publishes "DOM VIOL ASLT/THREATS" (63k records/yr — clearly
// aggravated domestic assault) and "PERSON THREATENING W/WEAPON" (25k
// records — UCR aggravated assault by definition). These got caught by
// /threaten|threats|domestic|fight/ in PART1_VIOLENT_EXCLUDE even
// though they describe Part-1 violent offenses. The override list is
// checked FIRST: if a description matches an explicit indicator, it
// counts as Part-1 regardless of EXCLUDE matches.
const PART1_VIOLENT_INCLUDE_OVERRIDE = [
  // "DOM VIOL ASLT/THREATS" — DV with assault abbreviation. Drops 63k
  // Cleveland records/yr that match /\bthreats\b/ even though they're
  // clearly aggravated DV. v100 — REQUIRE an assault/battery token: the
  // bare /domestic.*viol/ form force-counted EVERY DV-labelled row,
  // including Kansas City's "HARASSMENT/INTIMIDATION - DOMESTIC VIOLENCE",
  // "DOMESTIC VIOLENCE STEALING", and "DOMESTIC VIOLENCE BURGLARY" — none
  // of which are Part-1 violent. With the assault requirement, those fall
  // through to the existing /\bdomestic\b(?!.*assault)/ exclude, while
  // genuine "DOM VIOL ASLT" / "DOMESTIC VIOLENCE ASSAULT" still count.
  /dom\b.*viol.*(?:assault|aslt|batter)/i,
  /domestic.*viol.*(?:assault|aslt|batter)/i,
  // "PERSON THREATENING W/WEAPON" — UCR aggravated assault by
  // definition (threat + weapon). Drops 25k Cleveland records/yr that
  // match /\bthreaten/.
  /threat.*weapon/i,
  /threat.*firearm/i,
  /threat.*gun/i,
  /threat.*knife/i,
  /weapon.*threat/i,
  // v99 — aggravated assault is ALWAYS UCR Part-1 violent. Force-count it
  // even when the description also carries "domestic"/"strangulation" tokens
  // that would otherwise hit an EXCLUDE. Fixes Saint Paul "Aggravated
  // Assault, Domestic" / "AGG ASLT DMSTIC-..." (~3.5k/yr were dropped by
  // /\bdomestic\b(?!.*assault)/). Matches AGG / AGG. / AGGRAVATED + assault/aslt.
  /\bagg(?:ravated|\.?)\s*(?:assault|aslt)/i,
  // v99 — Denver files felony menacing-with-a-weapon under aggravated
  // assault (descriptor "Menacing Felony W Weap"); it was dropped by the
  // /\bmenacing\b/ EXCLUDE (~916/yr). Scope the rescue to the felony/weapon
  // qualifier so plain/simple menacing stays excluded elsewhere.
  /menacing.*felony/i,
  /menacing.*weap/i,
];

// Beats the INCLUDE override (see isPart1Violent). Definitionally never UCR
// Part-1 violent even if the row also carries a "domestic violence" /
// "aggravated" token from a coarse adapter label.
const PART1_VIOLENT_HARD_EXCLUDE = [
  /non-?aggravated/i,        // "ASSAULT (NON-AGGRAVATED)" = simple assault
  /property damage/i,        // "DOMESTIC VIOLENCE PROPERTY DAMAGE" = property/Part-2
  /protective order/i,       // "273.6 VIOLATION OF PROTECTIVE ORDER" = not violent
  /abuse of (?:a |an )?(?:child|minor)/i, // "ABUSE OF A CHILD" = Part-2 (reverse of /child abuse/)
  /\banimal\b/i,             // "ANIMAL ABUSE/CRUELTY" = NIBRS Society, not Part-1 violent
  /sexual abuse/i,           // non-rape sex offense = Part-2 (genuine "RAPE" is counted separately)
  /\bunfounded\b/i,          // Indianapolis "UNFOUNDED REPORT" = no crime occurred
  /indecent exposure/i,      // Denver "INDECENT EXPOSURE" = Part-2 sex offense, not forcible rape
  /sex offender/i,           // "SEX OFFENDER VIOLATION" = registry violation, Part-2 (not the offense)
];

function isPart1Violent(desc: string | undefined): boolean {
  if (!desc) return true;
  const cached = VIOLENT_CACHE.get(desc);
  if (cached !== undefined) return cached;
  let result = true;
  // HARD exclude — definitionally NEVER UCR Part-1 violent, so these beat
  // even the INCLUDE override. Without this, the broad /domestic.*viol/
  // override (added for Cleveland's aggravated "DOM VIOL ASLT") force-counted
  // every DV-labelled row, inflating violent: Kansas City's "ASSAULT
  // (NON-AGGRAVATED)" + "DOMESTIC VIOLENCE ASSAULT (NON-AGGRAVATED)" (~1.5k,
  // simple assault), "DOMESTIC VIOLENCE PROPERTY DAMAGE" (a property/Part-2
  // event), "ABUSE OF A CHILD" (Part-2), and Sacramento's "273.6 VIOLATION OF
  // PROTECTIVE ORDER" (not a violent crime). All are simple/Part-2 regardless
  // of any aggravated/DV token, so excluding them here is safe fleet-wide.
  if (PART1_VIOLENT_HARD_EXCLUDE.some((re) => re.test(desc))) {
    if (VIOLENT_CACHE.size >= PART1_CACHE_CAP) VIOLENT_CACHE.clear();
    VIOLENT_CACHE.set(desc, false);
    return false;
  }
  // Explicit Part-1 override wins over any EXCLUDE match.
  let overridden = false;
  for (const inc of PART1_VIOLENT_INCLUDE_OVERRIDE) if (inc.test(desc)) { overridden = true; break; }
  if (!overridden) {
    for (const ex of PART1_VIOLENT_EXCLUDE) if (ex.test(desc)) { result = false; break; }
  }
  if (VIOLENT_CACHE.size >= PART1_CACHE_CAP) VIOLENT_CACHE.clear();
  VIOLENT_CACHE.set(desc, result);
  return result;
}

function isPart1Property(desc: string | undefined): boolean {
  if (!desc) return true;
  const cached = PROPERTY_CACHE.get(desc);
  if (cached !== undefined) return cached;
  let result = true;
  for (const ex of PART1_PROPERTY_EXCLUDE) if (ex.test(desc)) { result = false; break; }
  if (PROPERTY_CACHE.size >= PART1_CACHE_CAP) PROPERTY_CACHE.clear();
  PROPERTY_CACHE.set(desc, result);
  return result;
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
  // v99 — the ALREADY-CALIBRATED combined annual rate per 100k (persons +
  // property local rates, each scaled by its own per-category CFS factor).
  // Passing the scaled rate directly keeps the divergence ratio on the same
  // yardstick as the rates shown to users, and works with per-category CFS
  // scaling (the old single cfsScale arg couldn't). Defaults below derive it
  // from totalIncidents for NIBRS callers that don't pre-scale.
  observedAnnualCombined?: number,
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
  const observedAnnual = observedAnnualCombined != null
    ? observedAnnualCombined
    : (pop > 0 ? (totalIncidents * (365 / windowDays) / pop) * 100_000 : 0);
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

function headlineForCity(grade: SafetyScoreResponse["grade"], cityLabel: string, anchor: "city-fbi" | "national" = "national"): string {
  // v44 — the prior headlines always said "FBI national rate" even
  // when the grade math actually used the city's OWN FBI baseline.
  // That mis-attribution made NOLA (grade B vs city baseline) sound
  // like it had below-national crime, when in reality NOLA's rate is
  // well above national but below NOLA's typical historical baseline.
  //
  // v50 — strip the redundant "(citywide)" suffix from the anchor
  // possessive so the headline reads "New Orleans (citywide) reports
  // below New Orleans's typical FBI-published rate" instead of the
  // doubled "New Orleans (citywide) reports below New Orleans
  // (citywide)'s typical FBI-published rate" form.
  const anchorCity = cityLabel.replace(/\s*\(citywide\)\s*$/i, "");
  const anchorLabel = anchor === "city-fbi"
    ? `${anchorCity}'s typical FBI-published rate`
    : "the FBI national rate";
  switch (grade) {
    case "A": return `${cityLabel} reports lower per-capita rates than ${anchorLabel}.`;
    case "B": return `${cityLabel} reports below ${anchorLabel}.`;
    case "C": return `${cityLabel} reports close to ${anchorLabel}.`;
    case "D": return `${cityLabel} reports higher per-capita rates than ${anchorLabel}. Use the cards below to see which category drives the gap.`;
    case "E": return `${cityLabel} reports notably higher per-capita rates than ${anchorLabel}.`;
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

// v95p3 — stricter under-count guard. The basic null guard above
// only catches totalCount === 0. Tucson (2026-05-26) tripped this:
// upstream feed was stale 8+ months, adapter had 1 PERSONS row in
// cache, totalCount=1, confidence="low" — but the grade math
// (1 / 546k pop) still produced rate ≈ 0 vs FBI 533, which the
// per-city grader interpreted as "far below baseline" → Grade A.
// That's a false-positive safety claim: the city isn't safer, our
// data is missing.
//
// Strengthened rule: when we have an FBI baseline AND confidence
// is "low" AND the observed rate sits below 5% of that baseline
// for EITHER category, suppress to N/A. The user sees "data
// unavailable" + the explanatory confidence note instead of a
// misleadingly favorable letter grade.
function gradeWithUndercountGuard(
  derivedGrade: SafetyScoreResponse["grade"],
  rows: SafetyScoreRow[],
  fbiBaseline: { violent: number; property: number } | undefined,
  confidence: SafetyScoreResponse["dataConfidence"],
  isCfsAdapter: boolean,
): SafetyScoreResponse["grade"] {
  if (!fbiBaseline || confidence !== "low") return derivedGrade;
  // NIBRS adapters: 5% threshold. Catches outright data outages
  // (Tucson 2026-05-26: 0/100k with 1 row stale 8mo) without false-
  // positives for genuinely low-crime cities.
  // CFS adapters: 20% threshold. CFS structurally undercounts vs
  // NIBRS, but Cleveland at 9.78% of FBI baseline is below the
  // floor where any soft-warn note can honestly justify a "below
  // baseline" letter grade. The cfsScale tuning was set when more
  // rows survived the Part-1 filter — drift since then has pushed
  // the adapter below the threshold where a meaningful grade is
  // defensible. Suppress with the existing calibration-progress
  // note instead of showing Grade A for a high-crime city.
  const undercountFloor = isCfsAdapter ? 0.20 : 0.05;
  const personsRow = rows.find((r) => r.category === "PERSONS");
  const propertyRow = rows.find((r) => r.category === "PROPERTY");
  const personsUnder = personsRow && fbiBaseline.violent > 0
    && personsRow.localPer100k < fbiBaseline.violent * undercountFloor;
  const propertyUnder = propertyRow && fbiBaseline.property > 0
    && propertyRow.localPer100k < fbiBaseline.property * undercountFloor;
  if (personsUnder || propertyUnder) return "N/A";
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
  return dedupe(`safety-score:${citySlug}`, () => computeCitywideSafetyScore(citySlug));
}

async function computeCitywideSafetyScore(citySlug: string): Promise<SafetyScoreResponse> {
  const { cityBySlug } = await import("./cities.js");
  // v96 — the prior `?? cityForArea("")` silently fell back to
  // CITIES[0] (San Diego) for any slug not in the registry. That
  // meant a user asking for houston / austin / portland (none of
  // which have adapters yet) got an HTTP 200 with San Diego's
  // numbers — same windowDays, same total counts — and the bug
  // was invisible until a side-by-side audit. Now throw an
  // explicit error; callers (route handlers, warm-worker) can
  // catch and convert to a 404.
  const city = cityBySlug(citySlug);
  if (!city) {
    throw new Error(`city_not_supported: ${citySlug}`);
  }
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
  // v59 — limit raised 5,000 → 50,000 per area. The prior 5k cap
  // worked for cities like Detroit (199 areas × few-dozen rows each)
  // but silently truncated Phoenix's biggest villages (Maryvale at
  // 26k rows in a 365-day cache, North Mountain at 24k, etc.) to
  // their 5k most-recent — which collapsed the safety-score's
  // effective window for that area from 365 days to ~70 days.
  // Across the city the aggregate count under-stated Phoenix's
  // Part-1 rate by ~13× vs FBI baseline. 50k is comfortably above
  // any single area's annual volume in the registry.
  const perArea = await Promise.all(
    areas.map((a) => crimeData.getIncidents(a.slug, { limit: 50000 }).catch(() => [])),
  );

  // v80 — parse occurredAt timestamps ONCE per incident. The pre-v80
  // code did `+new Date(i.occurredAt)` 3-5 times per row across the
  // timestamp-collection pass + the in-window counting pass + the
  // per-category sub-passes. With 50k-200k incidents per city × 3-5
  // re-parses each, this was 200k-1M Date constructor calls per
  // citywide score compute. A single parallel-array pass costs the
  // same as one of those passes and the remaining passes get a Float64
  // lookup for free.
  const perAreaTs: number[][] = perArea.map((incidents) => {
    const out = new Array<number>(incidents.length);
    for (let k = 0; k < incidents.length; k++) {
      const t = +new Date(incidents[k].occurredAt);
      out[k] = Number.isFinite(t) && t > 0 ? t : 0;
    }
    return out;
  });

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
  // v96 — MS_PER_DAY + RATE_WINDOW_DAYS hoisted to module top.
  const nowMs = Date.now();
  // windowStartMs is computed after the data span is known — see the anchor
  // block below (v99). It depends on anchorMs, which depends on the data's
  // newest timestamp.

  // Step 1: find the data span. The PRIOR implementation used the
  // single oldest row as dataEarliestMs, which gave a windowDays
  // dominated by outliers — e.g., Phoenix had a few rows from 365
  // days ago but the dense data only covered the last 60 days. The
  // annualization (count * 365/365) then under-stated the rate by
  // ~5× because most of "the year" was actually empty cache.
  //
  // v31 fix: use the 5th-PERCENTILE oldest row, so we trim away
  // sparse outliers. Concretely: collect every valid timestamp,
  // sort, take the timestamp at index Math.floor(N * 0.05). That's
  // the oldest moment containing the bottom 95% of incidents — a
  // much better proxy for "the dense data span" than the absolute
  // oldest row.
  const allTimestamps: number[] = [];
  for (let a = 0; a < perArea.length; a++) {
    const tsList = perAreaTs[a];
    for (let k = 0; k < tsList.length; k++) {
      const t = tsList[k];
      if (t <= 0 || t > nowMs) continue;
      allTimestamps.push(t);
    }
  }
  let dataEarliestMs = nowMs;
  if (allTimestamps.length > 0) {
    allTimestamps.sort((a, b) => a - b);
    // Trim 5% of the oldest rows; use the remaining oldest row.
    // For a city with 100 rows, that's the 5th-from-oldest row.
    // For 50,000 rows, that's the 2,500th-from-oldest.
    const trimIdx = Math.min(allTimestamps.length - 1, Math.floor(allTimestamps.length * OLDEST_TIMESTAMP_TRIM_FRACTION));
    dataEarliestMs = allTimestamps[trimIdx];
  }

  // v99 — anchor the rate window to the data's NEWEST timestamp when the feed
  // lags wall-clock by >14 days. The STABILITY FIX above anchors both bounds
  // to Date.now() to stop per-refresh rate swings, but for feeds with a large
  // fixed publication lag (Kansas City ~54d behind) or a stalled upstream
  // (Phoenix — no 2026 data) that charges the empty trailing days into
  // windowDays, dividing the incident count across a span the data doesn't
  // actually cover and systematically deflating the per-100k rate (KC property
  // read 0.56× FBI, Phoenix 0.34/0.43×, almost entirely from this). Fresh
  // feeds (latest within 14d of now) keep the stable wall-clock anchor — no
  // behavior change; only lagged/stale feeds shift their window end to the
  // last day that actually has data, so annualization divides by the real
  // covered span. allTimestamps is sorted ascending and pre-filtered to
  // t <= nowMs, so its last element is the newest non-future row.
  const dataLatestMs = allTimestamps.length > 0 ? allTimestamps[allTimestamps.length - 1] : nowMs;
  const anchorMs = (dataLatestMs > 0 && nowMs - dataLatestMs > 14 * MS_PER_DAY) ? dataLatestMs : nowMs;
  const windowStartMs = anchorMs - RATE_WINDOW_DAYS * MS_PER_DAY;

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
    const tsList = perAreaTs[a];
    let contributed = false;
    for (let k = 0; k < incidents.length; k++) {
      const i = incidents[k];
      const t = tsList[k];
      if (t <= 0) continue;
      if (t < windowStartMs || t > anchorMs) continue;
      const cat = i.nibrsCategory as "PERSONS" | "PROPERTY" | "SOCIETY";
      const desc = i.ibrOffenseDescription;
      let counted = false;
      if (cat === "PERSONS" && isPart1Violent(desc)) { persons += 1; counted = true; }
      else if (cat === "PROPERTY" && isPart1Property(desc)) { property += 1; counted = true; }
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
  // v99 — windowDays spans dataEarliest → anchorMs (the data's covered range),
  // NOT now, so a lagged/stale feed's empty trailing days don't dilute the
  // annualization. For fresh feeds anchorMs === nowMs (unchanged).
  const rawWindowDays = dataEarliestMs < anchorMs
    ? Math.min(RATE_WINDOW_DAYS, Math.max(1, Math.round((anchorMs - dataEarliestMs) / MS_PER_DAY)))
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
  // Clamp: only use the fresh-area subset when MOST of the city is
  // publishing (>=70%). Below that, fall back to cityPop because
  // the fresh subset is likely a non-representative slice (e.g.,
  // high-crime areas publishing while low-crime stay quiet, which
  // would over-inflate the rate). v31 raised the threshold from
  // 0.10 → 0.70 after Seattle prod data showed only 31% of areas
  // contributing — the 0.10 threshold accepted that subset, divided
  // ~30% of incidents by ~30% of pop, and amplified the per-100k
  // rate to ~3× FBI baseline because the fresh subset happened to
  // skew toward higher-crime neighborhoods.
  // v99 — clamp at cityPop. The fresh-area denominator is meant only to
  // SHRINK the population when part of a city's adapter coverage is stale
  // (DC/KC pattern). But several cities' generated per-neighborhood polygons
  // OVERLAP (Oakland's sum to 1.48× the real city population, Detroit 1.24×),
  // so freshPopSum can EXCEED cityPop and silently deflate the per-100k rate
  // (Oakland property read 0.52× FBI almost entirely from this). Capping at
  // cityPop is always correct: the denominator can never legitimately exceed
  // the city's actual residents.
  const pop = (popFraction >= FRESH_POP_FRACTION_THRESHOLD && freshPopSum > 0) ? Math.min(freshPopSum, cityPop) : cityPop;
  // CFS calibration — per-category (see CFS_CALIBRATION at the top of the file).
  // 1.0 for NIBRS adapters; per-category factors for CFS feeds.
  const { persons: cfsScalePersons, property: cfsScaleProperty, isCfs, sourceType } = cfsScalesFor(city.slug);
  const annualize = (count: number, scale: number) => {
    if (pop <= 0 || windowDays <= 0) return 0;
    return (count * (365 / windowDays) / pop) * 100_000 * scale;
  };

  // For the citywide endpoint the area IS the city, so cityPer100k =
  // localPer100k and cityDeltaPct = 0 by definition. The shape stays
  // consistent with the per-area endpoint so consumers can read either
  // through one branch.
  const personsLocal100k = Math.round(annualize(persons, cfsScalePersons));
  const propertyLocal100k = Math.round(annualize(property, cfsScaleProperty));
  const cityBaseline = CITY_FBI_BASELINES[city.slug];
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
      cityFbiPer100k: cityBaseline ? cityBaseline.violent : null,
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
      cityFbiPer100k: cityBaseline ? cityBaseline.property : null,
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
  let confidence = computeDataConfidence(windowDays, persons + property, pop, personsLocal100k + propertyLocal100k);
  const fbiBaseline = CITY_FBI_BASELINES[city.slug];
  const rawGrade = fbiBaseline
    ? gradeFromCityFbiBaseline(rows, fbiBaseline)
    : gradeFromNationalDeltas(rows);
  let grade = gradeWithNullGuard(rawGrade, persons + property, confidence.dataConfidence);
  // Note: gradeWithUndercountGuard runs AFTER the divergence guard
  // below — the divergence guard upgrades confidence to "low" for
  // CFS adapters between 3× and 20× divergence, and the under-count
  // guard reads that updated confidence to decide whether to suppress.

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
    // v86 — source-aware divergence threshold. NIBRS adapters are
    // expected to land within 3× of FBI; a wider divergence is the
    // signature of a partial pull / wrong calibration. CFS adapters
    // (Cleveland, Las Vegas, New Orleans, Boise — anything with
    // cfsScale<1) are STRUCTURALLY off-baseline — CFS counts events
    // and many real Part-1 crimes are dispatched under generic codes
    // (DISTURBANCE, TROUBLE) that don't survive our keyword filter.
    // Cleveland in particular ran 17.9× under FBI baseline and was
    // permanently N/A. For CFS sources we use a 20× threshold so a
    // calibration gap doesn't black out the city's grade entirely —
    // the dataConfidence note still warns users about the gap.
    const isCfsAdapter = isCfs;
    const divergenceThreshold = isCfsAdapter ? 20 : 3;
    if (worst >= divergenceThreshold) {
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
    } else if (worst >= 3 && isCfsAdapter) {
      // Soft-warn instead of suppress for CFS adapters between
      // 3× and 20×: grade stands but flag confidence so the UI
      // shows the explanatory note.
      confidence = {
        ...confidence,
        dataConfidence: "low",
        dataConfidenceNote:
          `${city.label}'s adapter is calls-for-service data which structurally undercounts vs FBI ` +
          `NIBRS (currently ${worst.toFixed(1)}× lower than the ${fbiBaseline.year} baseline). ` +
          `Grade is computed from CFS dispatches that match Part-1 keyword filters; treat as directional, ` +
          `not authoritative.`,
      };
    }
  }

  // v95p3 followup — run the under-count guard AFTER the divergence
  // guard so it sees the upgraded "low" confidence for CFS cities in
  // the 3×–20× soft-warn band. Without this ordering, Cleveland (CFS
  // at 15.6× divergence, ~9.78% of FBI baseline) skipped the under-
  // count guard because its initial confidence was "medium", then
  // got upgraded to "low" too late to suppress the misleading A.
  grade = gradeWithUndercountGuard(grade, rows, fbiBaseline, confidence.dataConfidence, isCfs);

  const headline = headlineForCity(grade, cityLabel, fbiBaseline ? "city-fbi" : "national");

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
      (sourceType === "cfs"
        ? ` ${city.label} publishes calls-for-service rather than closed NIBRS reports; rates are scaled per category (violent ×${cfsScalePersons}, property ×${cfsScaleProperty}) to approximate NIBRS-equivalent volumes (CFS is structurally inflated because each crime spawns multiple dispatches and many dispatches are unfounded — and the violent dispatch bucket is far more inflated than the property one, hence the separate factors).`
        : sourceType === "coarse"
        ? ` ${city.label}'s feed reports assaults in a single bucket with no simple-vs-aggravated severity field, so the violent rate can't be filtered to UCR Part-1 aggravated assault precisely; it is calibrated to the city's FBI baseline in aggregate (violent ×${cfsScalePersons}) and should be read as approximate.`
        : sourceType === "partial"
        ? (cfsScaleProperty !== 1 && cfsScalePersons === 1
            ? ` ${city.label}'s public crime feed under-publishes part of the FBI property-crime definition (much petty larceny/theft is not mapped publicly), so it structurally understates property crime; the property rate is calibrated up (×${cfsScaleProperty}) to approximate the FBI total and should be read as approximate.`
            : ` ${city.label}'s open feed omits part of the FBI violent-crime definition (e.g. non-weapon aggravated assault, or rape/sexual assault), so it structurally understates violent crime; the rate is calibrated up (×${cfsScalePersons}) to approximate the FBI total and should be read as approximate.`)
        : ""),
    ...confidence,
    dataSourceType: isCfs ? "cfs" : "nibrs",
    cfsScale: cfsScalePersons,
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
  // v62 — same 5k → 50k bump as the citywide variant. For per-area
  // safety-score on Phoenix (the only city where per-area volume
  // exceeded 5k), the prior cap silently dropped 80% of the
  // selected area's annual incidents and made the comparison-base
  // tiny relative to the rest of the city.
  const incidentsPerArea = await Promise.all(
    areas.map((a) => crimeData.getIncidents(a.slug, { limit: 50000 }).catch(() => [])),
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
  // v96 — PER_AREA_MS_PER_DAY and PER_AREA_RATE_WINDOW_DAYS hoisted
  // to module top (PER_AREA_MS_PER_DAY collapsed into the shared
  // MS_PER_DAY since they're literally identical).
  const nowMsArea = Date.now();
  const windowStartMsArea = nowMsArea - PER_AREA_RATE_WINDOW_DAYS * MS_PER_DAY;

  // v80 — parse timestamps once per row (same as the citywide variant).
  const tsPerArea: number[][] = incidentsPerArea.map((arr) => {
    const out = new Array<number>(arr.length);
    for (let k = 0; k < arr.length; k++) {
      const t = +new Date(arr[k].occurredAt);
      out[k] = Number.isFinite(t) && t > 0 ? t : 0;
    }
    return out;
  });

  // Oldest row across the FULL response — drives windowDays only.
  let dataEarliestMsArea = nowMsArea;
  for (let a = 0; a < incidentsPerArea.length; a++) {
    const tsList = tsPerArea[a];
    for (let k = 0; k < tsList.length; k++) {
      const t = tsList[k];
      if (t <= 0 || t > nowMsArea) continue;
      if (t < dataEarliestMsArea) dataEarliestMsArea = t;
    }
  }

  // Citywide totals across every tracked neighborhood, within the
  // CLOCK-anchored window.
  let cityPersons = 0, cityProperty = 0;
  let latest = 0;
  for (let a = 0; a < incidentsPerArea.length; a++) {
    const arr = incidentsPerArea[a];
    const tsList = tsPerArea[a];
    for (let k = 0; k < arr.length; k++) {
      const t = tsList[k];
      if (t <= 0) continue;
      if (t < windowStartMsArea || t > nowMsArea) continue;
      const i = arr[k];
      const cat = i.nibrsCategory as "PERSONS" | "PROPERTY" | "SOCIETY";
      const desc = i.ibrOffenseDescription;
      // Apply UCR Part 1 filter — see helper functions for rationale.
      if (cat === "PERSONS" && isPart1Violent(desc)) cityPersons += 1;
      else if (cat === "PROPERTY" && isPart1Property(desc)) cityProperty += 1;
      if (t > latest) latest = t;
    }
  }

  // This neighborhood's counts — reuse the fan-out result if discover()
  // returned our slug; otherwise pull directly.
  const idx = areas.findIndex((a) => a.slug === areaSlug);
  const areaIncidents = idx >= 0
    ? incidentsPerArea[idx]
    : await crimeData.getIncidents(areaSlug, { limit: 50000 }).catch(() => []);

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
  // v80 — reuse cached timestamps where available (idx >= 0 means
  // areaIncidents IS one of the entries in incidentsPerArea, so the
  // corresponding tsPerArea row already has parsed timestamps).
  let persons = 0, property = 0;
  const areaTs = idx >= 0 ? tsPerArea[idx] : null;
  for (let k = 0; k < areaIncidents.length; k++) {
    const i = areaIncidents[k];
    let t = areaTs ? areaTs[k] : 0;
    if (!areaTs) {
      const parsed = +new Date(i.occurredAt);
      t = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }
    if (t <= 0) continue;
    if (t < windowStartMsArea || t > nowMsArea) continue;
    const cat = i.nibrsCategory as "PERSONS" | "PROPERTY" | "SOCIETY";
    const desc = i.ibrOffenseDescription;
    if (cat === "PERSONS" && isPart1Violent(desc)) persons += 1;
    else if (cat === "PROPERTY" && isPart1Property(desc)) property += 1;
  }

  // windowDays from clock + adapter's oldest row (same stable formula
  // as the citywide variant). The per-area count above shares this
  // window via the per-area incident loop. Rounded to a 7-day boundary
  // to absorb sub-day cache drift; see roundWindowDays for rationale.
  const rawWindowDays = dataEarliestMsArea < nowMsArea
    ? Math.min(PER_AREA_RATE_WINDOW_DAYS, Math.max(1, Math.round((nowMsArea - dataEarliestMsArea) / MS_PER_DAY)))
    : 0;
  const windowDays = roundWindowDays(rawWindowDays);

  // Citywide annualized rate per 100k — uses the actual US Census Vintage
  // 2024 city population. Same CFS calibration as getCitywideSafetyScore
  // so per-area scores are comparable to the citywide grade.
  const { persons: cfsScalePersonsArea, property: cfsScalePropertyArea, isCfs: isCfsArea } = cfsScalesFor(city.slug);
  const annualizeCity = (count: number, scale: number) => {
    if (cityPop <= 0 || windowDays <= 0) return 0;
    return (count * 365 / windowDays / cityPop) * 100_000 * scale;
  };
  const cityPersons100k = annualizeCity(cityPersons, cfsScalePersonsArea);
  const cityProperty100k = annualizeCity(cityProperty, cfsScalePropertyArea);

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
    const localPersonsRate = popDenominator > 0 ? (persons * 365 / Math.max(1, windowDays) / popDenominator) * 100_000 * cfsScalePersonsArea : 0;
    const localPropertyRate = popDenominator > 0 ? (property * 365 / Math.max(1, windowDays) / popDenominator) * 100_000 * cfsScalePropertyArea : 0;
    personsScale = cityPersons100k > 0 ? localPersonsRate / cityPersons100k : 0;
    propertyScale = cityProperty100k > 0 ? localPropertyRate / cityProperty100k : 0;
  } else if (ourAreaKm2 != null && cityTotalKm2 > 0 && cityPop > 0) {
    const polygonAreaPop = cityPop * (ourAreaKm2 / cityTotalKm2);
    const areaPop = Math.max(polygonAreaPop, peerSharePop);
    popDenominator = Math.round(areaPop);
    // Apply CFS scaling here too — otherwise (raw_local / scaled_city)
    // ratio cancels the scaling out and per-area persons100k ends up
    // unscaled while citywide rates are scaled.
    const localPersonsRate = areaPop > 0 ? (persons * 365 / Math.max(1, windowDays) / areaPop) * 100_000 * cfsScalePersonsArea : 0;
    const localPropertyRate = areaPop > 0 ? (property * 365 / Math.max(1, windowDays) / areaPop) * 100_000 * cfsScalePropertyArea : 0;
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
  const cityBaselinePerArea = CITY_FBI_BASELINES[city.slug];
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
      cityFbiPer100k: cityBaselinePerArea ? cityBaselinePerArea.violent : null,
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
      cityFbiPer100k: cityBaselinePerArea ? cityBaselinePerArea.property : null,
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
  const confidence = computeDataConfidence(windowDays, persons + property, popDenominator, persons100k + property100k);

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
    dataSourceType: isCfsArea ? "cfs" : "nibrs",
    cfsScale: cfsScalePersonsArea,
  };
}
