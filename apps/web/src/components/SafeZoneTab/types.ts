/// Shared type contracts for the SafeZoneTab module.
///
/// Every widget in this folder consumes one of these interfaces and is
/// otherwise stateless — no fetching, no caching, no global access. The
/// goal is drop-in reusability: a partner application can render any
/// widget from this module by satisfying its props alone.

export type BlockScoreBand = "safe" | "moderate" | "elevated";

export interface BlockScore {
  /// 0–100 normalized safety index. 100 = safest. The number combines
  /// the user-selected area's annualized rate vs. the FBI national rate
  /// across the two reported NIBRS groups (Persons + Property).
  score: number;
  /// Bucket used for color coding: safe ≥80, moderate 50–79, elevated <50.
  band: BlockScoreBand;
  /// Plain-English headline (e.g. "Well below the national rate.")
  headline: string;
  /// Citation for the comparison benchmark.
  benchmark: { label: string; url: string; year: number };
  /// ISO timestamp of the most recent incident in the cached window —
  /// drives the "Verified · synced X ago" trust badge on the widget.
  asOf?: string | null;
}

export type ThreatConfidence =
  | "verified"            // Official police adapter; report is closed/published.
  | "community-confirmed" // Multiple community signals OR moderator-approved post.
  | "developing"          // Adapter row but very recent — initial report only.
  | "unverified";         // Single community signal, not yet moderated.

export interface ThreatItem {
  id: string;
  /// ISO timestamp.
  at: string;
  /// Short, sanitized incident description (e.g. "Larceny — Shoplifting").
  /// Never contains personal identifiers, suspect demographics, or
  /// addresses beyond block level.
  description: string;
  category: "PERSONS" | "PROPERTY" | "SOCIETY";
  /// Block-level location string if the upstream feed published one.
  block?: string;
  /// Trust signal for this individual incident. Drives the badge in
  /// the threat-feed row. Defaults to "verified" for adapter rows
  /// older than 2 hours; "developing" for fresh adapter rows where
  /// the initial report may still be subject to investigation/
  /// correction. Community-sourced rows can carry "community-
  /// confirmed" or "unverified" depending on moderation status.
  confidence: ThreatConfidence;
}

export interface BaselinePoint {
  /// ISO date for the start of the weekly bucket.
  weekStart: string;
  count: number;
}

export interface SafeZoneSelection {
  city: { slug: string; label: string };
  /// Null when the user is viewing the whole city.
  area: { slug: string; label: string } | null;
}

export interface SafeZoneDataState {
  selection: SafeZoneSelection;
  blockScore: BlockScore | null;
  threats: ThreatItem[];
  /// Used to populate the analytical-baseline fallback graph when
  /// `threats` is empty for the 30-day window.
  baseline: BaselinePoint[];
  windowDays: number;
  /// Most recent incident timestamp in the cached window.
  asOf: string | null;
  /// Per-city police-feed citation surfaced from the active adapter's
  /// PROVENANCE. Page components hand this to ThreatFeed so users see
  /// a real per-city source link (data.sandiego.gov, opendata.dc.gov,
  /// etc.) instead of the generic FBI CDE URL the page formerly
  /// hardcoded.
  source: { label: string; url: string } | null;
  loading: boolean;
  error: Error | null;
}
