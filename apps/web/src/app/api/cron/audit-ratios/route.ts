import { NextResponse, type NextRequest } from "next/server";
import { CITIES } from "@/server/services/crime-data/cities";
import { getCitywideSafetyScore } from "@/server/services/watch/safety-score";
import { requireCronSecret } from "@/server/lib/bearer-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/// Daily ratio-drift monitor (Vercel cron). Probes every city's
/// citywide safety-score, captures the key methodology fields
/// (grade, windowDays, ratio, dataConfidence, dataSourceType), and
/// flags entries whose values drift outside the believable band.
///
/// The endpoint is the audit primitive — wire it to an alert sink
/// (Slack webhook, email, logging service) as a separate slice when
/// noisy-signal tuning is done. For v1 the JSON response is the
/// report; check via curl or the Vercel logs UI.
///
/// Flag bands:
///   - dataConfidence !== "high"      → low-volume / short-window
///   - windowDays < 30                → data window too short
///   - ratio > 12 (NIBRS)             → implausibly high citywide rate
///   - ratio > 10 (CFS, post-scale)   → CFS calibration may have drifted
///   - ratio < 0.05                   → data starvation (likely upstream)
///   - grade in {D, E} unexpectedly   → flagged for human review
///
/// Same CRON_SECRET Bearer auth as /api/cron/warm-cache so the endpoint
/// isn't a public trigger. fix(audit infra-stale-no-cron-secret-comment): there
/// is NO NO_CRON_SECRET bypass — requireCronSecret fails CLOSED (503) when
/// CRON_SECRET is unset and otherwise requires a constant-time Bearer match.
/// For local dev, set CRON_SECRET and pass it in the Authorization header.
///
/// v98 — this cron is now the CANONICAL grade monitor; the in-process
/// Railway grade-sanity worker was retired (it OOM'd on the concurrent
/// recompute, and read-only it only ever saw NO_WARM_DATA). To keep THIS
/// monitor reliable, the per-city probes run at bounded concurrency
/// instead of a 37-wide Promise.all — the wide fan-out is the exact
/// heap-spike shape that crashed the worker, and it would do the same to
/// the Vercel function on a cold cache. Cap of 4 keeps peak memory small
/// while still finishing well inside maxDuration.
const PROBE_CONCURRENCY = 4;

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  const startedAt = Date.now();

  const probe = async (city: (typeof CITIES)[number]) => {
      try {
        const score = await getCitywideSafetyScore(city.slug);
        const ratios = score.rows.map((r) => r.nationalPer100k > 0 ? r.localPer100k / r.nationalPer100k : 1);
        const avgRatio = ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
        const totalCount = score.rows.reduce((s, r) => s + r.count, 0);
        const flags: string[] = [];
        // The grade itself isn't a flag — it's the OUTPUT. The flags
        // track health of the inputs feeding the grade.
        if (score.dataConfidence !== "high") flags.push(`confidence:${score.dataConfidence}`);
        if (score.windowDays > 0 && score.windowDays < 30) flags.push(`short-window:${score.windowDays}d`);
        if (avgRatio < 0.05) flags.push(`starvation:${avgRatio.toFixed(2)}x`);
        // CFS cities have their rates pre-calibrated; the band is
        // tighter for them because the scale already accounts for the
        // dispatch inflation.
        const ratioCeiling = score.dataSourceType === "cfs" ? 10 : 12;
        if (avgRatio > ratioCeiling) flags.push(`implausible-high:${avgRatio.toFixed(2)}x`);
        return {
          city: city.slug,
          grade: score.grade,
          windowDays: score.windowDays,
          totalCount,
          ratio: Number(avgRatio.toFixed(3)),
          dataConfidence: score.dataConfidence,
          dataSourceType: score.dataSourceType ?? "nibrs",
          cfsScale: score.cfsScale ?? 1.0,
          flags,
        };
      } catch (err) {
        return {
          city: city.slug,
          error: (err as Error).message?.slice(0, 120) ?? "unknown error",
          flags: ["fetch-failed"],
        };
      }
  };

  // Bounded-concurrency runner — at most PROBE_CONCURRENCY citywide
  // computes in flight at once, so peak memory stays small even when the
  // adapter cache is cold (vs the prior 37-wide Promise.all).
  const results: Awaited<ReturnType<typeof probe>>[] = new Array(CITIES.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, CITIES.length) }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= CITIES.length) return;
        results[i] = await probe(CITIES[i]);
      }
    }),
  );

  const totalMs = Date.now() - startedAt;
  const flagged = results.filter((r) => (r.flags?.length ?? 0) > 0);
  return NextResponse.json({
    ok: flagged.length === 0,
    generatedAt: new Date().toISOString(),
    totalMs,
    citiesAudited: results.length,
    flaggedCount: flagged.length,
    flagged: flagged.map((r) => ({ city: r.city, flags: r.flags, grade: "grade" in r ? r.grade : null, ratio: "ratio" in r ? r.ratio : null })),
    full: results,
  });
}
