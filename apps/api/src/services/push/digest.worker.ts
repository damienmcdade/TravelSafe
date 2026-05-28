import { runDailyDigest } from "./digest.service.js";
import { getRedis, redisReady } from "../../lib/redis.js";

// Daily-fire scheduler for the push digest. Replaces Vercel Cron's
// "0 16 * * *" entry; Railway runs a persistent container so we can
// just check the wall clock every minute.
//
// Restart-safety: v60 — lastFiredYmd persists to Redis when REDIS_URL
// is configured (Railway plugin auto-injects it). Without persistence
// a container restart between 16:00 UTC and 23:59 UTC would re-fire
// the digest; web push de-dupes by `tag: "digest-daily"` so users only
// see one bubble even on a double-send, but the backend redoes the
// (paid) fan-out work. With Redis the worker reads/writes the daily
// stamp at SETEX 36h so even a clock-skew restart can't refire.
// In-memory copy `lastFiredYmd` is kept as a fast-path check so we
// don't round-trip to Redis on every tick.

const DIGEST_HOUR_UTC = 16;
const TICK_INTERVAL_MS = 60 * 1000;
const REDIS_KEY = "digest-worker:last-fired-ymd";
const REDIS_TTL_SECONDS = 36 * 60 * 60;
let timer: NodeJS.Timeout | null = null;
let lastFiredYmd: string | null = null;
// v96 — backpressure flag. The 60 s tick checks the wall clock, but
// once it decides to fire, runDailyDigest can run for minutes on a
// 10k-user fan-out. Without this guard the next tick fires before
// the prior runDailyDigest finishes, both pass the
// `lastFiredYmd === todayYmd` check (still null in memory), Redis
// might not be stamped yet either, and both call runDailyDigest()
// concurrently — doubling the (paid) webpush fan-out work.
let inFlight = false;

function ymdUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function tick() {
  if (inFlight) return;
  const now = new Date();
  const todayYmd = ymdUtc(now);
  if (lastFiredYmd === todayYmd) return;
  if (now.getUTCHours() < DIGEST_HOUR_UTC) return;
  inFlight = true;
  // Cross-restart guard: if Redis remembers we already fired today,
  // hydrate the in-memory copy and bail without rerunning the fan-out.
  const redis = getRedis();
  if (redis) {
    try {
      const stamped = await redis.get(REDIS_KEY);
      if (stamped === todayYmd) {
        console.log(`[digest-worker] skipping ${todayYmd} (already fired per redis)`);
        lastFiredYmd = todayYmd;
        return;
      }
    } catch (err) {
      console.warn("[digest-worker] redis check failed, proceeding:", (err as Error).message);
    }
  }
  try {
    const result = await runDailyDigest();
    console.log(`[digest-worker] fired ${todayYmd}: ${JSON.stringify(result)}`);
    lastFiredYmd = todayYmd;
    if (redis) {
      try {
        await redis.setex(REDIS_KEY, REDIS_TTL_SECONDS, todayYmd);
      } catch (err) {
        console.warn("[digest-worker] redis stamp failed:", (err as Error).message);
      }
    }
  } catch (err) {
    console.error("[digest-worker] tick failed:", err);
  } finally {
    inFlight = false;
  }
}

export function startDigestWorker() {
  if (timer) return;
  console.log(`[digest-worker] starting (daily fire at ${DIGEST_HOUR_UTC}:00 UTC, tick every ${TICK_INTERVAL_MS / 1000}s)`);
  timer = setInterval(() => {
    tick().catch((err) => console.error("[digest-worker] tick threw:", err));
  }, TICK_INTERVAL_MS);
  // v96 — wait for Redis to be ready before the FIRST tick. The
  // lazy-connect client used to reject the boot tick's redis.get
  // with "Stream isn't writeable" because the socket was still
  // connecting. Now the tick lands only after the socket is up
  // (or after the helper's 5 s timeout, in which case the in-
  // memory fallback path kicks in correctly without the misleading
  // warning).
  void redisReady().finally(() => {
    tick().catch((err) => console.error("[digest-worker] boot tick threw:", err));
  });
}

export function stopDigestWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  lastFiredYmd = null;
}
