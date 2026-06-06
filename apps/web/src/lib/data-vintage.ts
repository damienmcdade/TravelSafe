// v67 — single source of truth for the FBI Crime Data Explorer
// vintage year referenced across page metadata, OG images,
// disclaimers, and per-city descriptions. The audit caught "2025"
// hardcoded across 10+ files; bumping the year required a sweep
// across the repo. Now a one-line constant change here lifts every
// surface in lockstep.
//
// Update each year when the FBI's CDE publishes the new annual
// totals (typically Q3 of the following year — e.g. 2025 figures
// publish ~Sept 2026).
// fix(audit fbi-anchor-year-mix-1): set to 2023 (revised) — the national
// benchmark and the 44 per-city baselines are both FBI 2023 (the 2023 rates as
// restated in the FBI 2024 report: violent 379.5 / property 1934.1). The vintage
// label MUST match the benchmark the scores are compared against, so this stays
// in lockstep with FBI_NATIONAL_SOURCE.publishedYear in
// packages/crime-data/src/safety-score.ts. (The FBI's 2024 national pair is
// 359.1 / 1760.1; we anchor to 2023 because that is the vintage of the city
// baselines — mixing vintages is what the prior pass got wrong.)
export const FBI_DATA_YEAR = 2023;
export const FBI_DATA_LABEL = `FBI Crime Data Explorer ${FBI_DATA_YEAR}`;
