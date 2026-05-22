import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { crimeData } from "@/server/services/crime-data";

// GET /api/safety/:locationId/trends
//
// Returns the past 12 months of aggregated trend data for the given
// neighborhood slug. Optimized to feed a frontend chart / skeleton-loader
// when the recent 30-day window is empty. Response contract:
//
//   {
//     "locationId": "sd-north-park",
//     "trend": [
//       { "yearMonth": "2025-06", "totalIncidents": 142, "aggregatedSafetyScore": 78 },
//       …
//     ],
//     "windowMonths": 12,
//     "source": { "label": "...", "url": "..." }
//   }
//
// ──────────────────────────────────────────────────────────────────────
// Reference: equivalent PostGIS / SQL implementation (target schema)
// ──────────────────────────────────────────────────────────────────────
//   SELECT year_month,
//          total_incident_count       AS "totalIncidents",
//          aggregated_safety_score    AS "aggregatedSafetyScore"
//     FROM location_monthly_trends
//    WHERE location_id = $1
//      AND year_month >= TO_CHAR((NOW() - INTERVAL '12 months')::date, 'YYYY-MM')
//    ORDER BY year_month ASC;
//
// (Parameterized — $1 binds the validated locationId — never interpolated
// into the SQL string, so this is injection-safe.)
//
// The current Next.js implementation computes the 12-month aggregation
// on the fly from the adapter cache (the police feed is the source of
// truth here). When the data layer migrates to the pre-aggregated
// `location_monthly_trends` table, the SQL above replaces the in-memory
// reducer below and the response contract stays identical.

const Params = z.object({ locationId: z.string().min(1).max(120) });

interface MonthlyPoint {
  yearMonth: string;            // "YYYY-MM"
  totalIncidents: number;
  aggregatedSafetyScore: number; // 0–100, higher = safer
}
interface TrendsResponse {
  locationId: string;
  trend: MonthlyPoint[];
  windowMonths: number;
  source: { label: string; url: string };
}

function ym(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/// Convert a per-month incident count + an overall reference into a 0–100
/// "aggregated safety score". The reference baseline is the median of all
/// observed months for this area, so an unusually busy month scores lower
/// than the area's own baseline and an unusually quiet one scores higher.
/// Floor 5, ceiling 95 to avoid degenerate end-state values.
function monthlyScore(count: number, median: number): number {
  if (median <= 0) return count === 0 ? 95 : 50;
  const ratio = count / median;
  // ratio 0   → 95 (much quieter than usual)
  // ratio 1   → 60 (around the area's own baseline)
  // ratio 2   → 25 (twice as busy as the median month)
  // ratio ≥3  → 5  (floor)
  if (ratio <= 0.5) return 95;
  if (ratio <= 1.0) return Math.round(95 - 35 * (ratio - 0.5) * 2);     // 95→60
  if (ratio <= 2.0) return Math.round(60 - 35 * (ratio - 1.0));         // 60→25
  return Math.max(5, Math.round(25 - 20 * (ratio - 2.0)));
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export const GET = wrap(async (
  _req: NextRequest,
  ctx: { params: Promise<{ locationId: string }> },
) => {
  const { locationId } = Params.parse(await ctx.params);

  // Pull the area's full cached window. The adapter typically holds the
  // most recent ~5k incidents — plenty to bucket by month for a year.
  const incidents = await crimeData.getIncidents(locationId, { limit: 5000 }).catch(() => []);

  // Build monthly buckets for the last 12 calendar months ending this
  // month (inclusive). Months with no incidents in the cache still emit
  // a zero-count row so the consumer can render a continuous timeline.
  const now = new Date();
  const buckets: Record<string, number> = {};
  const order: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = ym(d);
    buckets[key] = 0;
    order.push(key);
  }
  for (const inc of incidents) {
    const t = new Date(inc.occurredAt);
    if (Number.isNaN(t.getTime())) continue;
    const key = ym(t);
    if (key in buckets) buckets[key] += 1;
  }
  const counts = order.map((k) => buckets[k]);
  // Median over months with at least one record so quiet months don't
  // skew the baseline toward zero.
  const nonZero = counts.filter((n) => n > 0).slice().sort((a, b) => a - b);
  const median = nonZero.length === 0 ? 0 : nonZero[Math.floor(nonZero.length / 2)];

  const trend: MonthlyPoint[] = order.map((yearMonth) => ({
    yearMonth,
    totalIncidents: buckets[yearMonth],
    aggregatedSafetyScore: monthlyScore(buckets[yearMonth], median),
  }));

  // Cite the same adapter that powers the rest of the app.
  const sample = await crimeData.getAreaStats(locationId).catch(() => null);
  const body: TrendsResponse = {
    locationId,
    trend,
    windowMonths: 12,
    source: {
      label: sample?.provenance.source ?? "Local police open-data feed",
      url: sample?.provenance.datasetUrl ?? "about:blank",
    },
  };
  return NextResponse.json(body);
});
