// BASE rates: FBI Crime Data Explorer (api.usa.gov/crime/fbi/cde) per-agency
// annual rates per 100k. BASE_FBI_BASELINES below can be regenerated from the
// CDE (tools/build-city-fbi-baselines.mjs seeds these), BUT the exported
// CITY_FBI_BASELINES applies MANUAL_BASELINE_OVERRIDES on top — documented
// corrections where the raw CDE figure is wrong/stale/incomplete for a city
// (e.g. Chicago, whose CPD stats the FBI doesn't fully accept). v99: the
// overrides are kept SEPARATE from the base table specifically so a future
// regeneration of BASE_FBI_BASELINES does NOT silently revert them — preserve
// MANUAL_BASELINE_OVERRIDES across any regen.
//
// Each entry is the city's OWN FBI-published rate — the authoritative
// comparison anchor for citywide scoring (vs the national average, which is
// pulled down by rural areas and collapses every urban city to grade E).
//
// Lives in @travelsafe/crime-data so both apps/web (Vercel routes) and
// apps/api (Railway routes) consume the same baselines without drift.

export interface CityFbiBaseline {
  /// Per-100k annual rate for NIBRS Crimes Against Persons /
  /// UCR Violent Crime, summed across 12 months of the latest
  /// complete year.
  violent: number;
  /// Same for Crimes Against Property.
  property: number;
  /// Reporting year these rates apply to.
  year: number;
  /// FBI 9-character ORI for the city's reporting agency.
  ori: string;
}

const BASE_FBI_BASELINES: Record<string, CityFbiBaseline> = {
  // v102 — 2025 full-year from data.brla.gov (BRPD's own feed, the one the
  // app scores against): 3,091 violent + 10,711 property charges / 217,387
  // pop = 1422 / 4927. BR is decoupled (no CFS scale), so the baseline must
  // match the feed's charge-level basis for correct grading — using the
  // older UCR-summary 1009 would mismatch the inflated feed. Cross-checked
  // vs AH Datalytics RTCI snapshot (1433/4876).
  "baton-rouge": { violent: 1422, property: 4927, year: 2025, ori: "LA0170200" },
  "boise": { violent: 286, property: 850, year: 2025, ori: "ID0010100" },
  "boston": { violent: 582, property: 1914, year: 2025, ori: "MA0130100" },
  "buffalo": { violent: 729, property: 3414, year: 2025, ori: "NY0140100" },
  "cambridge": { violent: 436, property: 2601, year: 2025, ori: "MA0091100" },
  "charlotte": { violent: 559, property: 3418, year: 2025, ori: "NC0600100" },
  "chicago": { violent: 420, property: 2956, year: 2025, ori: "ILCPD0000" },
  "cincinnati": { violent: 779, property: 3599, year: 2025, ori: "OHCIP0000" },
  "cleveland": { violent: 1360, property: 3949, year: 2025, ori: "OHCLP0000" },
  "dallas": { violent: 576, property: 3070, year: 2025, ori: "TXDPD0000" },
  "colorado-springs": { violent: 670, property: 3900, year: 2025, ori: "CO0210100" },
  // v70 — FBI CDE 2025 reported rates for Denver PD ORI CO0160100.
  "denver": { violent: 873, property: 4196, year: 2025, ori: "CO0160100" },
  "detroit": { violent: 1652, property: 3949, year: 2025, ori: "MI8234900" },
  "kansas-city": { violent: 1371, property: 3970, year: 2025, ori: "MOKPD0000" },
  "las-vegas": { violent: 409, property: 2418, year: 2025, ori: "NV0020100" },
  "los-angeles": { violent: 669, property: 2251, year: 2025, ori: "CA0194200" },
  "milwaukee": { violent: 1145, property: 2401, year: 2025, ori: "WIMPD0000" },
  "minneapolis": { violent: 1003, property: 4509, year: 2025, ori: "MN0271100" },
  "baltimore": { violent: 1440, property: 3730, year: 2025, ori: "MD0240100" },
  "new-orleans": { violent: 1250, property: 4025, year: 2025, ori: "LANPD0000" },
  "new-york": { violent: 658, property: 2288, year: 2025, ori: "NY0303000" },
  "norfolk": { violent: 397, property: 3176, year: 2025, ori: "VA1170000" },
  "oakland": { violent: 1475, property: 5255, year: 2025, ori: "CA0010900" },
  "philadelphia": { violent: 825, property: 4349, year: 2025, ori: "PAPEP0000" },
  "fort-worth": { violent: 392, property: 2323, year: 2025, ori: "TX2200200" },
  "pittsburgh": { violent: 470, property: 2364, year: 2025, ori: "PAPPD0000" },
  "saint-paul": { violent: 490, property: 2824, year: 2025, ori: "MN0620900" },
  "san-diego": { violent: 373, property: 1551, year: 2025, ori: "CA0371100" },
  "san-francisco": { violent: 486, property: 2960, year: 2025, ori: "CA0380100" },
  "seattle": { violent: 700, property: 4446, year: 2025, ori: "WASPD0000" },
  "washington-dc": { violent: 748, property: 3081, year: 2025, ori: "DCMPD0000" },
  // v90 — 5 new cities. FBI CDE 2024 values (2025 SRS not yet published).
  "sacramento":   { violent: 720,  property: 2299, year: 2025, ori: "CA0340400" },
  "atlanta":      { violent: 732,  property: 3111, year: 2025, ori: "GAAPD0000" },
  "indianapolis": { violent: 769,  property: 2819, year: 2025, ori: "INIPD0000" },
  "raleigh":      { violent: 393,  property: 2300, year: 2025, ori: "NC0920100" },
  "tucson":       { violent: 515,  property: 2590, year: 2025, ori: "AZ0100100" },
  // v95p2 — Honolulu (HPD ORI HI0010100). FBI CDE 2024 reported
  // rates. Honolulu is structurally lower-crime than mainland peer
  // cities and these baselines reflect that.
  "honolulu":     { violent: 193,  property: 1494, year: 2025, ori: "HI0010100" },
  // v100 — Long Beach (LBPD ORI CA0194100). FBI UCR 2024: violent 3,030
  // (murder 37 + rape ~200 + robbery ~989 + agg assault ~1,779) / property
  // 15,581, over pop 450,917 → 672 / 3,456 per 100k. Do NOT confuse with
  // CA0198200 (CSU Long Beach PD).
  "long-beach":   { violent: 621,  property: 2553, year: 2025, ori: "CA0194100" },
};

// Documented manual corrections applied OVER BASE_FBI_BASELINES. Each is a city
// whose raw FBI CDE figure is wrong/stale/incomplete; kept SEPARATE from the
// base table so regenerating BASE_FBI_BASELINES can't silently revert them.
// Verified against FBI CDE + 2+ aggregators (NeighborhoodScout/AreaVibes) 2026-05.
const MANUAL_BASELINE_OVERRIDES: Record<string, Partial<Pick<CityFbiBaseline, "violent" | "property">>> = {
  // The FBI doesn't fully accept CPD's stats (Chicago records ALL criminal
  // sexual assaults + merges aggravated battery into aggravated assault), so the
  // CDE violent (~420) is far too low. Anchored to Chicago's own Part-1
  // measurement (agg assault 04A + agg battery 04B + robbery 03 + CSA 02 +
  // homicide 01A) from the same open-data feed the app scores against.
  "chicago": { violent: 620, property: 3700 },
  // CDE understated Oakland's 2023 spike (~1900 violent / ~7200 property).
  "oakland": { violent: 1900 },
  // v100 — Dallas. Stored base (576/3070) was off in BOTH directions vs the
  // authoritative FBI 2024 figures (4 aggregators agree): violent 658
  // (8,698 offenses / ~1.32M; murder 180 + rape ~480 + robbery ~2,230 + agg
  // assault 5,818), property 3,352 (44,295; the city's huge ~14.5k auto-theft
  // volume). Raising violent EXPOSES a real open-data under-capture (the DPD
  // feed carries almost no family-violence aggravated assault — only ~7/87d),
  // tracked separately; the baseline must still be the true FBI rate.
  "dallas": { violent: 658, property: 3352 },
  // v100 — Denver + Phoenix base rates ran LOW vs FBI 2024 (NeighborhoodScout +
  // AreaVibes agree). Denver: violent 985 (7,170; agg assault 5,151 + rape 676),
  // property 4,740. Denver's feed then reads ~0.55-0.6× — a genuine redaction
  // under-capture, calibrated separately.
  "denver": { violent: 985, property: 4740 },
  // CDE base is the older year; SF crime rose in 2024 (~560 / ~3400).
  "san-francisco": { violent: 560, property: 3400 },
  // KCMO is high-crime. FBI 2024 (4 aggregators): violent 1,547/100k (8,698
  // offenses, 77% aggravated assault), property 4,676/100k (23,920) — the
  // stored base (1371/3970) was low on both. v100: corrected after the KC
  // geocode-drop fix recovered the ~28% of incidents that were silently
  // dropped (so raising property no longer produces a false grade-A).
  "kansas-city": { violent: 1547, property: 4676 },
};

export const CITY_FBI_BASELINES: Record<string, CityFbiBaseline> = Object.fromEntries(
  Object.entries(BASE_FBI_BASELINES).map(([slug, base]) => [
    slug,
    { ...base, ...(MANUAL_BASELINE_OVERRIDES[slug] ?? {}) },
  ]),
);
