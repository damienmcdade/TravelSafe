import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/lib/env";
import { CITIES } from "@/server/services/crime-data/cities";
import { crimeData } from "@/server/services/crime-data";
import { getCitywideSafetyScore } from "@/server/services/watch/safety-score";
import { getCitywideTrend } from "@/server/services/watch/trend-feed";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel Cron hits this once daily (Hobby plan limit — Pro unlocks
// minute-level schedules). The adapter cache TTL is 5 min so a daily hit
// only guarantees a warm window briefly each day. For continuous warming
// (e.g. on Pro), change the vercel.json schedule to `*/4 * * * *` so the
// cache slot is replaced before each 5-min expiry. The handler can also
// be triggered externally (UptimeRobot, GitHub Actions cron, etc.) on a
// 4-min cadence — pass CRON_SECRET as a Bearer header to authorize.
//
// If CRON_SECRET is set, require it as a Bearer header so the endpoint
// isn't a public trigger.
export async function GET(req: NextRequest) {
  // CRON_SECRET is REQUIRED — see /api/cron/audit-ratios for rationale.
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_secret_required" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
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
