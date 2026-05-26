import { CITIES } from "@travelsafe/crime-data/cities";
import {
  getCitywideSafetyScore,
  type SafetyScoreResponse,
} from "@travelsafe/crime-data/safety-score";
import { getRedis } from "../../lib/redis.js";

// v64 — continuous grade sanity worker. Runs every 5 minutes on
// Railway alongside the warm-worker and digest worker. For each
// city's citywide safety score, it computes a set of sanity flags
// and persists the latest snapshot to Redis (when configured) under
// `grade-sanity:{slug}`. A diagnostic API surfaces the whole report
// at /diag/grade-sanity for ops + alerting.
//
// Why this exists: the audit caught San Diego, Las Vegas, Cleveland,
// and Boston returning grade=N/A and Las Vegas + Cleveland over-
// counting PERSONS by 3-4.5× FBI baseline. Without a continuous
// check, an upstream feed shift can silently produce wrong grades
// for hours before anyone notices in the UI. The worker turns the
// 1-off grade audit into a recurring background check.

const TICK_INTERVAL_MS = 5 * 60 * 1000;
const REDIS_KEY_PREFIX = "grade-sanity:";
const REDIS_TTL_SECONDS = 15 * 60; // ~3 ticks of grace
let timer: NodeJS.Timeout | null = null;
let inFlight = false;
let lastReport: GradeReport | null = null;

export interface GradeFlag {
  code: string;
  detail: string;
}

export interface GradeSnapshot {
  slug: string;
  grade: SafetyScoreResponse["grade"] | null;
  windowDays: number | null;
  confidence: SafetyScoreResponse["dataConfidence"] | null;
  asOfAgeDays: number | null;
  personsCount: number;
  propertyCount: number;
  personsRatio: number | null;
  propertyRatio: number | null;
  flags: GradeFlag[];
  error?: string;
}

export interface GradeReport {
  generatedAt: string;
  durationMs: number;
  cities: GradeSnapshot[];
  flaggedCount: number;
}

const DAY_MS = 86_400_000;

// v90p8 — per-city stale-asOf acknowledgements. These cities have
// upstream publishing delays we've already investigated and
// documented in ~/communitysafe-operator-notes.md (sections 4, 7).
// The grade-sanity worker still records the staleness in the snapshot
// for transparency, but suppresses the STALE_ASOF flag for these
// known cases so the report's "flagged" count surfaces NEW issues
// instead of being permanently noisy with documented behaviour.
//
//   phoenix   — PPD RMS migration paused publishing since late 2025
//   sacramento — Sacramento publishes year-specific datasets;
//                2026 dataset provisioned but not yet populated.
//                Adapter dual-fetches; self-heals when 2026 fills.
//   tucson    — TPD applies multi-month investigative hold;
//                public layer's freshest record is ~11 months old.
const STALE_ASOF_ACKNOWLEDGED = new Set(["phoenix", "sacramento", "tucson"]);

function classify(snap: GradeSnapshot): GradeFlag[] {
  const flags: GradeFlag[] = [];
  if (snap.error) {
    flags.push({ code: "FETCH_ERROR", detail: snap.error });
    return flags;
  }
  if (snap.grade === "N/A") flags.push({ code: "GRADE_NA", detail: "Cannot grade — see ratios" });
  if (snap.confidence === "low") flags.push({ code: "CONF_LOW", detail: "Low confidence — short window or implausible rate" });
  if (snap.windowDays != null && snap.windowDays < 30) {
    flags.push({ code: "SHORT_WINDOW", detail: `windowDays=${snap.windowDays}` });
  }
  if (snap.asOfAgeDays != null && snap.asOfAgeDays > 60 && !STALE_ASOF_ACKNOWLEDGED.has(snap.slug)) {
    flags.push({ code: "STALE_ASOF", detail: `latest incident ${snap.asOfAgeDays}d old` });
  }
  if (snap.personsRatio != null && (snap.personsRatio < 0.3 || snap.personsRatio > 3.0)) {
    flags.push({ code: "PERSONS_OUTLIER", detail: `ratio=${snap.personsRatio.toFixed(2)} (FBI band 0.3-3.0)` });
  }
  if (snap.propertyRatio != null && (snap.propertyRatio < 0.3 || snap.propertyRatio > 3.0)) {
    flags.push({ code: "PROPERTY_OUTLIER", detail: `ratio=${snap.propertyRatio.toFixed(2)} (FBI band 0.3-3.0)` });
  }
  if (snap.personsCount === 0 && snap.propertyCount === 0) {
    flags.push({ code: "NO_DATA", detail: "Both PERSONS and PROPERTY counts are 0" });
  }
  return flags;
}

// v80 — read warm-worker's Redis L2 entry first; recompute only if
// missing. Pre-v80 every sanity tick re-ran the full safety-score
// computation for all 31 cities (60-300ms each, ~10s+ total even
// hot) duplicating work the warm-worker just finished. With the
// Redis short-circuit we read 31 small JSON blobs (<10ms total) in
// the common case and only spend compute when warm-worker's cycle
// is mid-flight or a city's L2 entry expired.
async function probeCity(slug: string, nowMs: number): Promise<GradeSnapshot> {
  try {
    const redis = getRedis();
    let s: Awaited<ReturnType<typeof getCitywideSafetyScore>> | null = null;
    if (redis) {
      try {
        const cached = await redis.get(`citywide:${slug}`);
        if (cached) {
          const parsed = JSON.parse(cached) as Awaited<ReturnType<typeof getCitywideSafetyScore>>;
          // Same sanity gate the route uses — reject degenerate cached
          // values so we recompute instead of double-flagging on a bad
          // cached row.
          const totalCounted = (parsed.rows ?? []).reduce((sum, r) => sum + ((r as { count?: number }).count ?? 0), 0);
          if (((parsed as { windowDays?: number }).windowDays ?? 0) > 0 && totalCounted > 0) {
            s = parsed;
          }
        }
      } catch {
        // Redis fail-soft — fall through to compute below
      }
    }
    if (!s) s = await getCitywideSafetyScore(slug);
    const persons = (s.rows || []).find((r) => r.category === "PERSONS");
    const property = (s.rows || []).find((r) => r.category === "PROPERTY");
    const snap: GradeSnapshot = {
      slug,
      grade: s.grade,
      windowDays: s.windowDays ?? null,
      confidence: s.dataConfidence ?? null,
      asOfAgeDays: s.asOf ? Math.round((nowMs - +new Date(s.asOf)) / DAY_MS) : null,
      personsCount: persons?.count ?? 0,
      propertyCount: property?.count ?? 0,
      personsRatio: persons && (persons.cityFbiPer100k ?? 0) > 0 ? persons.localPer100k / (persons.cityFbiPer100k as number) : null,
      propertyRatio: property && (property.cityFbiPer100k ?? 0) > 0 ? property.localPer100k / (property.cityFbiPer100k as number) : null,
      flags: [],
    };
    snap.flags = classify(snap);
    return snap;
  } catch (err) {
    const snap: GradeSnapshot = {
      slug,
      grade: null,
      windowDays: null,
      confidence: null,
      asOfAgeDays: null,
      personsCount: 0,
      propertyCount: 0,
      personsRatio: null,
      propertyRatio: null,
      flags: [],
      error: (err as Error).message.slice(0, 200),
    };
    snap.flags = classify(snap);
    return snap;
  }
}

async function tick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  const t0 = Date.now();
  try {
    const snaps = await Promise.all(CITIES.map((c) => probeCity(c.slug, t0)));
    const flaggedCount = snaps.filter((s) => s.flags.length > 0).length;
    const report: GradeReport = {
      generatedAt: new Date(t0).toISOString(),
      durationMs: Date.now() - t0,
      cities: snaps,
      flaggedCount,
    };
    lastReport = report;

    // Persist per-city snapshots to Redis so the diag endpoint can
    // surface them even if a fresh probe is mid-flight.
    const redis = getRedis();
    if (redis) {
      try {
        await Promise.all(
          snaps.map((s) =>
            redis.setex(`${REDIS_KEY_PREFIX}${s.slug}`, REDIS_TTL_SECONDS, JSON.stringify(s)),
          ),
        );
        await redis.setex(`${REDIS_KEY_PREFIX}__report`, REDIS_TTL_SECONDS, JSON.stringify(report));
      } catch (err) {
        console.warn("[grade-sanity] redis persist failed:", (err as Error).message);
      }
    }

    if (flaggedCount > 0) {
      const summary = snaps
        .filter((s) => s.flags.length > 0)
        .map((s) => `${s.slug}:${s.flags.map((f) => f.code).join(",")}`)
        .join(" | ");
      console.log(`[grade-sanity] ${flaggedCount}/${snaps.length} flagged · ${report.durationMs}ms · ${summary}`);
    } else {
      console.log(`[grade-sanity] all ${snaps.length} cities clean · ${report.durationMs}ms`);
    }
  } catch (err) {
    console.error("[grade-sanity] tick failed:", err);
  } finally {
    inFlight = false;
  }
}

export function startGradeSanityWorker(): void {
  if (timer) return;
  console.log(`[grade-sanity] starting (cycle every ${TICK_INTERVAL_MS / 1000}s)`);
  // Wait one full cycle before first probe so the warm-worker has a
  // chance to populate the adapter cache. Otherwise the first sanity
  // pass would flag every adapter as cold/empty.
  timer = setInterval(() => void tick(), TICK_INTERVAL_MS);
}

export function stopGradeSanityWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
  inFlight = false;
  lastReport = null;
}

export function getLastReport(): GradeReport | null {
  return lastReport;
}
