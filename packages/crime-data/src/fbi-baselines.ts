// BASE rates: FBI Crime Data Explorer (cde.ucr.cjis.gov) per-agency annual
// rates per 100k. BASE_FBI_BASELINES below can be regenerated from the CDE
// (tools/build-city-fbi-baselines.mjs seeds these), BUT the exported
// CITY_FBI_BASELINES applies MANUAL_BASELINE_OVERRIDES on top — documented
// corrections where the raw CDE figure is wrong/stale/incomplete for a city
// (e.g. Chicago, whose CPD stats the FBI doesn't fully accept). v99: the
// overrides are kept SEPARATE from the base table specifically so a future
// regeneration of BASE_FBI_BASELINES does NOT silently revert them — preserve
// MANUAL_BASELINE_OVERRIDES across any regen.
//
// fix(audit fbi-baseline-understatement, 2026-06-05): an official-source
// cross-reference against the FBI CDE found BASE was systematically ~15-30% LOW
// vs the agencies' real published rates (esp. property), making citywide grades
// too LENIENT. Regenerated BASE from FBI CDE agency data for the COMPLETE 2023
// reporting year (the latest year complete for every agency; the prior "2025"
// labels were not backed by FBI data) and corrected 3 wrong ORIs (baltimore
// MD0240100→MDBPD0000 [was Berlin PD], tucson AZ0100100→AZ0100300 [was South
// Tucson], honolulu HI0010100→HI0020000 [was Hilo PD]). Each agency series was
// verified by name; phoenix reproduced EXACTLY (785), validating the method.
// Grade shifts (all toward accuracy, i.e. harsher for previously-too-lenient
// cities): san-diego A→B; charlotte/los-angeles/sacramento/atlanta/indianapolis
// C→D; milwaukee/minneapolis/philadelphia D→E; las-vegas/norfolk/pittsburgh/
// raleigh B→C. HELD AT PRIOR VALUES (not regenerated): the MANUAL_OVERRIDE
// cities (chicago/oakland/dallas/denver/san-francisco/kansas-city — overrides
// apply on top); baton-rouge (intentional charge-level basis matching its feed);
// virginia-beach (CDE returns no 2023 agency series; stored 116/1699 verified
// accurate); washington-dc/new-york/colorado-springs/fort-worth (no clean CDE
// agency series this pass — fort-worth's stored ORI TX2200200 resolves to Azle
// PD and needs a separate fix; DC's real 2023 rate is materially higher and is
// flagged for a follow-up correction).
//
// fix(audit fbi-year-label, 2026-06-06): 9 entries still carried `year: 2025`
// — a reporting year the FBI has NOT published (2024 is the latest, released
// Aug 2025; 2025 publishes ~Sept 2026). The `year` is metadata ONLY (rendered
// verbatim in the user-facing citywide disclaimer; it does NOT affect any
// grade) and it contradicted the 2023 vintage shown elsewhere. Relabeled to
// 2024 (the latest real FBI year): accurate for the MANUAL_OVERRIDE cities
// whose comments cite "FBI 2024" (dallas/denver/kansas-city/san-francisco), and
// the most-recent real year for the held estimates (baton-rouge/colorado-
// springs/new-york/chicago/oakland) that lacked a clean 2023 CDE agency series.
// Values are UNCHANGED — this is a labeling-honesty fix only.
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
  "baton-rouge": { violent: 1422, property: 4927, year: 2024, ori: "LA0170200" },
  "boise": { violent: 280, property: 1268, year: 2023, ori: "ID0010100" },
  "phoenix": { violent: 785, property: 2495, year: 2023, ori: "AZ0072300" },
  "jacksonville": { violent: 661, property: 2598, year: 2023, ori: "FL0160000" },
  "virginia-beach": { violent: 116, property: 1699, year: 2023, ori: "VA1210000" },
  // Dayton (DPD, ORI OH0570200): FBI CDE 2023, computed from agency actuals ÷
  // agency population (the CDE pre-computed rates are unreliable for this agency).
  "dayton": { violent: 1182, property: 4763, year: 2023, ori: "OH0570200" },
  "gainesville": { violent: 749, property: 2927, year: 2023, ori: "FL0010100" },
  "tampa": { violent: 469, property: 1686, year: 2023, ori: "FL0290200" },
  // Nashville (Metro Nashville PD, ORI TN0190100): FBI CDE 2023 — 8,909 violent
  // + 31,821 property on the MNPD agency population → ~1,071 / ~3,825 per 100k.
  "nashville": { violent: 1071, property: 3825, year: 2023, ori: "TN0190100" },
  // Houston (HPD, ORI TX1010000): FBI CDE 2023 per-100k (approx; large agency).
  "houston": { violent: 1072, property: 4367, year: 2023, ori: "TX1010000" },
  // Montgomery County, MD (MCPD, ORI MD0150000): derived from the agency's OWN
  // 2023 NIBRS data (Data Montgomery icn6-v9z3) on UCR Part-1 definitions —
  // violent (murder 09A + rape 11A + robbery 120 + agg assault 13A) = 2,067;
  // property (burglary 220 + larceny 23x + MV theft 240 + arson 200) = 19,792 —
  // over the 2020 county population (1,062,061) → ~195 / ~1,864 per 100k. Matches
  // FBI CDE 2023 (property ~1,848) within rounding.
  "montgomery-county": { violent: 195, property: 1864, year: 2023, ori: "MD0150000" },
  // Prince George's County, MD (PGPD, ORI MD0160000): PGPD's published 2023 UCR
  // totals — 4,163 violent + 17,674 property — over the 2020 county population
  // (967,201) → ~430 / ~1,827 per 100k. Violent cross-checks FBI CDE 2023 (~447).
  "prince-georges-county": { violent: 430, property: 1827, year: 2023, ori: "MD0160000" },
  "boston": { violent: 634, property: 1965, year: 2023, ori: "MA0130100" },
  "buffalo": { violent: 761, property: 4286, year: 2023, ori: "NY0140100" },
  "cambridge": { violent: 479, property: 2402, year: 2023, ori: "MA0091100" },
  "charlotte": { violent: 726, property: 3854, year: 2023, ori: "NC0600100" },
  "chicago": { violent: 420, property: 2956, year: 2024, ori: "ILCPD0000" },
  "cincinnati": { violent: 743, property: 4303, year: 2023, ori: "OHCIP0000" },
  "cleveland": { violent: 1726, property: 4981, year: 2023, ori: "OHCLP0000" },
  "dallas": { violent: 576, property: 3070, year: 2024, ori: "TXDPD0000" },
  "colorado-springs": { violent: 670, property: 3900, year: 2024, ori: "CO0210100" },
  "denver": { violent: 873, property: 4196, year: 2024, ori: "CO0160100" },
  "detroit": { violent: 2051, property: 4845, year: 2023, ori: "MI8234900" },
  "kansas-city": { violent: 1371, property: 3970, year: 2024, ori: "MOKPD0000" },
  "las-vegas": { violent: 473, property: 3101, year: 2023, ori: "NV0020100" },
  "los-angeles": { violent: 820, property: 2851, year: 2023, ori: "CA0194200" },
  "milwaukee": { violent: 1502, property: 2820, year: 2023, ori: "WIMPD0000" },
  "minneapolis": { violent: 1137, property: 5309, year: 2023, ori: "MN0271100" },
  "baltimore": { violent: 1694, property: 5160, year: 2023, ori: "MDBPD0000" },
  "new-orleans": { violent: 1361, property: 5090, year: 2023, ori: "LANPD0000" },
  "new-york": { violent: 658, property: 2288, year: 2024, ori: "NY0303000" },
  "norfolk": { violent: 543, property: 3851, year: 2023, ori: "VA1170000" },
  "oakland": { violent: 1475, property: 5255, year: 2024, ori: "CA0010900" },
  "philadelphia": { violent: 992, property: 5121, year: 2023, ori: "PAPEP0000" },
  // v112 — corrected to the REAL Fort Worth PD. The prior ORI TX2200200 was Azle
  // PD (a tiny suburb, 337/1567); Fort Worth PD is TX2201200 → FBI CDE 2023
  // 498 violent / 2680 property. Grade shifts B→C (accurate). Calibration retuned.
  "fort-worth": { violent: 498, property: 2680, year: 2023, ori: "TX2201200" },
  "pittsburgh": { violent: 507, property: 2532, year: 2023, ori: "PAPPD0000" },
  "saint-paul": { violent: 626, property: 3157, year: 2023, ori: "MN0620900" },
  "san-diego": { violent: 425, property: 1831, year: 2023, ori: "CA0371100" },
  "san-francisco": { violent: 486, property: 2960, year: 2024, ori: "CA0380100" },
  "seattle": { violent: 789, property: 5071, year: 2023, ori: "WASPD0000" },
  // DC MPD (DCMPD0000) polices all of DC. fix(audit dc-baseline-trueup): the
  // v112 value (1157/4336) overstated it. FBI CDE 2023 for this agency (pop
  // 678,972) sums to 7,149 violent / 28,291 property over the 12 months →
  // 1053 / 4167 per 100k (the violent rate cross-checks exactly against CDE's
  // published monthly rate series). Still a severe rate; calibration unchanged.
  "washington-dc": { violent: 1053, property: 4167, year: 2023, ori: "DCMPD0000" },
  "sacramento": { violent: 805, property: 2980, year: 2023, ori: "CA0340400" },
  "atlanta": { violent: 709, property: 3917, year: 2023, ori: "GAAPD0000" },
  "indianapolis": { violent: 1088, property: 3594, year: 2023, ori: "INIPD0000" },
  // Honolulu (Honolulu PD, ORI HI0020000): FBI CDE 2023 per-100k for the agency
  // that polices the City & County of Honolulu (the prior ORI HI0010100 resolved
  // to Hilo PD — corrected in fix(audit fbi-baseline-understatement) above).
  // Hawaii's low violent rate is reflected here (222 violent / 2,122 property).
  "honolulu": { violent: 222, property: 2122, year: 2023, ori: "HI0020000" },
  "long-beach": { violent: 637, property: 3183, year: 2023, ori: "CA0194100" },
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
  // CDE understated Oakland's 2023 spike; the raw 2023 CDE agency series is in
  // fact CORRUPT (returns ~3641 violent / ~10153 property, ~2× reality), which
  // is exactly why this override exists. Anchored to ~1900 violent / ~7200
  // property (NeighborhoodScout/USAFacts).
  "oakland": { violent: 1900 },
  // v100 — Dallas. FBI 2024 (4 aggregators agree): violent 658 (8,698 offenses /
  // ~1.32M; murder 180 + rape ~480 + robbery ~2,230 + agg assault 5,818),
  // property 3,352 (44,295; the city's huge ~14.5k auto-theft volume). The DPD
  // feed carries almost no family-violence aggravated assault — tracked
  // separately; the baseline must still be the true FBI rate.
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
