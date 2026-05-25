import { NextResponse, type NextRequest } from "next/server";
import { CITIES } from "@/server/services/crime-data/cities";
import { crimeData } from "@/server/services/crime-data";
import { getCitywideSafetyScore } from "@/server/services/watch/safety-score";
import { getCitywideTrend } from "@/server/services/watch/trend-feed";
import { requireCronSecret } from "@/server/lib/bearer-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// v59 — REMOVED from vercel.json crons. The Railway warm-worker
// (apps/api/src/services/warm/cache.worker.ts) handles continuous
// cache warming on a 4-minute cycle, which keeps the adapter cache
// hot 24/7 within its 5-min TTL. The Vercel daily cron used to
// fail with 504s because the parallel fan-out across 30+ cities
// (including the heaviest adapters like NYC paginated + Phoenix
// 20-page + Detroit 199-area) could not complete inside Vercel's
// 60s function ceiling.
//
// The handler is intentionally LEFT in place for manual debugging
// (curl with CRON_SECRET Bearer) and as a fail-safe if Railway ever
// goes down — just no longer Vercel-scheduled.
export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  const startedAt = Date.now();
  // The server-side CITIES registry only contains cities with verified live
  // public crime APIs — no need for a status filter.
  const cities = CITIES.map((c) => c.slug);

  // Fan out across every live city in parallel. Each city's warm path is
  // also internally parallelized (Promise.all over per-area incident
  // pulls), so total wall-clock is bounded by the slowest single-city
  // pull rather than summed sequentially. With 29 live cities the whole
  // pass completes in 2-15s depending on upstream latencies.
  const results = await Promise.all(
    cities.map(async (slug) => {
      const cityStart = Date.now();
      const [citywide, score, trend] = await Promise.allSettled([
        crimeData.getCitywide(slug),
        getCitywideSafetyScore(slug),
        getCitywideTrend(slug),
      ]);
      return {
        city: slug,
        ms: Date.now() - cityStart,
        citywide: citywide.status === "fulfilled" ? "ok" : "fail",
        score:    score.status    === "fulfilled" ? "ok" : "fail",
        trend:    trend.status    === "fulfilled" ? "ok" : "fail",
      };
    }),
  );

  const totalMs = Date.now() - startedAt;
  const failures = results.filter((r) => r.citywide === "fail" || r.score === "fail" || r.trend === "fail");
  return NextResponse.json({
    ok: failures.length === 0,
    cities: cities.length,
    totalMs,
    failures: failures.length,
    detail: results,
  });
}
