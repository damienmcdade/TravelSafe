// Self-calibrating neighborhood risk bands.
//
// Most city adapters derive a 1-5 riskLevel from the raw incident count
// in a neighborhood over the cached window. Hand-picked count thresholds
// don't transfer across cities — a "high" monthly count in Cambridge is
// a rounding error in Chicago — and they freeze in place as a city's
// reporting volume drifts year to year. Each adapter therefore carried
// its own block of magic numbers (`inArea.length > 2000 ? 5 : ...`),
// hand-tuned per city and marked with a "calibrate later" TODO.
//
// Instead we bucket each neighborhood against the LIVE distribution of
// per-neighborhood counts within its OWN city: a neighborhood lands in
// band N when its count clears the (N-1)th quintile of that city's
// distribution. This self-calibrates as volume drifts and makes "risk"
// explicitly relative to the rest of the city rather than to absolute
// magic numbers that mean different things in different places.
//
// This is the count-based analog of the SANDAG regional-RATE bands in
// sandag-socrata.ts — same quintile idea, same degrade-to-static-bands
// posture. The two stay separate because SANDAG derives its bands from a
// separate per-jurisdiction rate query rather than from incident rows.

/// Linear-interpolated quantile over an ascending-sorted array.
export function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/// Group incident rows by area and return the incident count per area —
/// the distribution the quintiles are taken over. Empty/"Unknown" areas
/// are dropped, and areas with fewer than `minCount` incidents (default
/// 3, matching the discovered-areas floor) are excluded so a single
/// stray geocode can't anchor a quintile.
export function areaCounts<T>(
  rows: readonly T[],
  areaOf: (r: T) => string | null | undefined,
  minCount = 3,
): number[] {
  const byArea = new Map<string, number>();
  for (const r of rows) {
    const a = areaOf(r)?.trim();
    if (!a || a.toLowerCase() === "unknown") continue;
    byArea.set(a, (byArea.get(a) ?? 0) + 1);
  }
  return [...byArea.values()].filter((c) => c >= minCount);
}

/// Derive ascending quintile breakpoints from a distribution, degrading
/// to `fallback` (the adapter's prior hand-tuned thresholds, ascending)
/// when there are too few neighborhoods to form meaningful quintiles or
/// the distribution is degenerate (non-increasing breakpoints — e.g.
/// every neighborhood near-identical), so a thin or flat dataset can
/// never distort or collapse the scale.
export function deriveBands(distribution: number[], fallback: readonly number[]): number[] {
  if (distribution.length < 5) return [...fallback];
  const sorted = [...distribution].sort((a, b) => a - b);
  const bands = [0.2, 0.4, 0.6, 0.8].map((q) => quantile(sorted, q));
  const strictlyIncreasing = bands.every((b, i) => i === 0 || b > bands[i - 1]);
  return strictlyIncreasing ? bands : [...fallback];
}

/// Bucket a count into 1-5 against ascending breakpoints. Uses strict
/// `>` to match the original `length > N` adapter semantics exactly, so
/// the static-fallback path reproduces prior shipped behavior.
export function bucketByBands(value: number, bands: readonly number[]): 1 | 2 | 3 | 4 | 5 {
  let level = 1;
  for (const b of bands) if (value > b) level += 1;
  return Math.min(level, 5) as 1 | 2 | 3 | 4 | 5;
}

/// Convenience wrapper for the common count-based adapter path: derive
/// this city's bands from `rows` and bucket `count` against them in one
/// call. `fallback` is the adapter's prior ascending thresholds.
export function riskLevelFromAreaCounts<T>(
  rows: readonly T[],
  count: number,
  fallback: readonly number[],
  areaOf: (r: T) => string | null | undefined = (r) => (r as { area?: string }).area,
): 1 | 2 | 3 | 4 | 5 {
  const bands = deriveBands(areaCounts(rows, areaOf), fallback);
  return bucketByBands(count, bands);
}
