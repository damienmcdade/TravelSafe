/// v99 — per-city data-freshness classifier. Police open-data feeds
/// publish on wildly different cadences (San Francisco/Oakland daily;
/// LAPD bi-weekly; NYPD/SDPD quarterly; Pittsburgh monthly), so "the
/// newest incident is N days old" only means "stale" relative to each
/// city's own cadence. This maps a city slug + the freshest incident
/// date to an honest user-facing recency line, so the UI can say
/// "Latest data: May 16 — LAPD publishes bi-weekly" for a healthy feed
/// vs "⚠ no new reports since Mar 30" for a genuinely frozen one
/// (e.g. Philadelphia's CARTO sync, Kansas City's 2026 dataset — both
/// confirmed frozen upstream with no successor as of 2026-05-31).

export type FreshnessStatus = "fresh" | "stale" | "unknown";

export interface Freshness {
  /// ISO date of the newest incident the feed has published (or null).
  asOf: string | null;
  /// Whole days between asOf and the reference "now".
  daysSince: number | null;
  /// "fresh" = within the city's expected cadence; "stale" = the feed
  /// appears to have stopped publishing; "unknown" = no data to judge.
  status: FreshnessStatus;
  /// One honest sentence for the UI.
  note: string;
}

interface Cadence {
  /// Max days the newest row may lag before we call the feed stale.
  /// Sized to the city's real publish cadence + its normal reporting lag.
  expectedDays: number;
  /// Optional clause appended to the "fresh" line to explain a non-daily
  /// cadence (so a 2-week-old LAPD feed doesn't read as broken).
  cadenceNote?: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Default assumes a daily feed with a few days' reporting lag. Overrides
// below are derived from the 2026-05-31 freshness audit of each live feed.
const DEFAULT_CADENCE: Cadence = { expectedDays: 10 };
const CITY_CADENCE: Record<string, Cadence> = {
  "los-angeles": { expectedDays: 18, cadenceNote: "LAPD publishes its NIBRS feed about every two weeks" },
  "new-york":    { expectedDays: 110, cadenceNote: "NYPD publishes this dataset quarterly" },
  "san-diego":   { expectedDays: 110, cadenceNote: "SDPD publishes its NIBRS data quarterly" },
  "pittsburgh":  { expectedDays: 40, cadenceNote: "Pittsburgh's feed updates roughly monthly" },
  "las-vegas":   { expectedDays: 26, cadenceNote: "LVMPD's feed typically runs a few weeks behind" },
  "sacramento":  { expectedDays: 32, cadenceNote: "Sacramento's feed has been running ~2 weeks behind" },
  "cambridge":   { expectedDays: 16, cadenceNote: "Cambridge publishes weekly" },
  "boston":      { expectedDays: 16 },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "an unknown date";
  // UTC to keep it stable regardless of render runtime; day-level only.
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/// Classify how fresh a city's data is. `asOfIso` is the newest incident
/// timestamp the feed has published for the area/city; `nowMs` is the
/// reference time (pass Date.now() at the call site — kept as a param so
/// callers in workflow/test contexts stay deterministic).
export function classifyFreshness(
  citySlug: string,
  cityLabel: string,
  asOfIso: string | null,
  nowMs: number,
): Freshness {
  if (!asOfIso) {
    return { asOf: null, daysSince: null, status: "unknown", note: "" };
  }
  const asOfMs = +new Date(asOfIso);
  if (!Number.isFinite(asOfMs) || asOfMs <= 0) {
    return { asOf: null, daysSince: null, status: "unknown", note: "" };
  }
  const daysSince = Math.max(0, Math.floor((nowMs - asOfMs) / MS_PER_DAY));
  const cadence = CITY_CADENCE[citySlug] ?? DEFAULT_CADENCE;
  const dateStr = fmtDate(asOfIso);

  if (daysSince > cadence.expectedDays) {
    return {
      asOf: asOfIso,
      daysSince,
      status: "stale",
      note: `${cityLabel}'s police feed hasn't published any new incident reports since ${dateStr}. ` +
        `That's the most recent data available upstream — not a gap in your area specifically.`,
    };
  }
  const note = cadence.cadenceNote
    ? `Latest data: ${dateStr}. ${cadence.cadenceNote}, so the newest reports lag a little.`
    : `Latest data: ${dateStr}.`;
  return { asOf: asOfIso, daysSince, status: "fresh", note };
}
