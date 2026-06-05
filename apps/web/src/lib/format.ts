/// Canonical number formatters. Multiple cards across the app render
/// crime rates per 100,000 population — and prior to consolidation
/// they used inconsistent precision (`toFixed(0)` on some, raw
/// `toLocaleString()` on others), which meant the same source number
/// could display as "1,235" on one card and "1234.56" on the next.
/// Single source of truth fixes that without forcing a layout change
/// in any individual card.

/// Format a per-100k-population rate as a comma-grouped integer with
/// the canonical " / 100k" suffix. Returns "—" for null / NaN so
/// callers don't need to guard.
///
/// Why integer (rounded): per-100k rates aggregated over a 30-day
/// window typically run from single digits to low thousands. Decimal
/// precision is noise at that scale — and the FBI national-rate
/// references CommunitySafe compares against are also published as
/// integers.
export function formatRatePer100k(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n).toLocaleString()} / 100k`;
}

/// Same number, but with the spelled-out " per 100k" suffix — used in
/// running prose (aria-labels, headlines) where the slash reads
/// awkwardly. Prefer this in screen-reader contexts.
export function formatRatePer100kProse(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "no data";
  return `${Math.round(n).toLocaleString()} per 100k`;
}

/// Format a delta percentage with explicit sign so "+12%" reads
/// differently from "12%" at a glance. Rounded to whole percent —
/// sub-percent precision implies a confidence we don't have.
export function formatDeltaPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const rounded = Math.round(pct);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

/// Format a "newest report" date (e.g. score.asOf) DETERMINISTICALLY.
///
/// Pins both the locale ("en-US") and the timezone ("UTC") so the server
/// (which runs in UTC) and the browser (any local TZ) render the IDENTICAL
/// string. Without this, `new Date(asOf).toLocaleDateString()` uses each
/// runtime's own TZ + locale: on the server-rendered city / neighborhood
/// profile pages (where the score is an SSR prop), that produced a server-vs-
/// client text mismatch → React #418 hydration error whenever `asOf` sits near
/// a day boundary (intermittent, more frequent on some cities). UTC is also the
/// correct interpretation for a date-only value — a negative-offset local TZ
/// would otherwise render it off-by-one (the previous calendar day).
export function formatReportDate(asOf: string | null | undefined): string | null {
  if (!asOf) return null;
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}
