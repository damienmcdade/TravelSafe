import Redis from "ioredis";
import { env } from "../env.js";

// Shared Redis client for Railway services that need a cross-restart
// cache. Lazy-initialized so the API still boots cleanly when REDIS_URL
// is unset (every consumer must handle a null client and fall back to
// in-memory or no-cache). When REDIS_URL is set, the client connects
// lazily on first command — startup never blocks waiting for Redis to
// be reachable.
//
// Railway: provision the Redis plugin from the dashboard. It auto-injects
// REDIS_URL into the service env. No further config needed.

let client: Redis | null = null;
let initFailed = false;

export function getRedis(): Redis | null {
  if (client) return client;
  if (initFailed) return null;
  if (!env.REDIS_URL) return null;
  try {
    client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      // Don't crash the API on a transient Redis blip — let the cache
      // call fail-soft and the caller fall through to its in-memory
      // path or recompute.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    client.on("error", (err) => {
      console.warn("[redis] error:", err.message);
    });
    client.on("connect", () => {
      console.log("[redis] connected");
    });
    return client;
  } catch (err) {
    console.warn("[redis] init failed:", (err as Error).message);
    initFailed = true;
    return null;
  }
}

export function isRedisEnabled(): boolean {
  return !!env.REDIS_URL;
}

/// A dedicated connection for SUBSCRIBE. A client in subscriber mode can't run
/// normal commands, so pub/sub needs its own socket separate from getRedis().
/// Returns null when REDIS_URL is unset. Used by the community-events bus.
export function getRedisSubscriber(): Redis | null {
  if (!env.REDIS_URL) return null;
  try {
    const sub = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    sub.on("error", (err) => console.warn("[redis] subscriber error:", err.message));
    return sub;
  } catch (err) {
    console.warn("[redis] subscriber init failed:", (err as Error).message);
    return null;
  }
}

// v96 — wait helper for the boot-time race between the workers and the
// Redis client. The client is lazyConnect=true with enableOfflineQueue=
// false, which means any command issued during the brief "connecting"
// window is rejected with "Stream isn't writeable". Specifically, the
// digest worker's boot tick was logging
// "[digest-worker] redis check failed, proceeding: Stream isn't
// writeable" on every container start. The cache fallback path worked,
// but the noise was misleading. Callers that want the warm Redis path
// can `await redisReady()` once at the start of their boot tick to
// avoid issuing commands until the socket is up. Resolves with the
// client when ready, null when REDIS_URL is unset or the connection
// can't be established within READY_TIMEOUT_MS.
const READY_TIMEOUT_MS = 5_000;
// Coalesce concurrent waiters onto ONE pending promise. Without this, every
// caller during the connecting window registers its own ready+error listener
// pair on the single shared client — with the 5 rate-limit stores each calling
// redisReady() on the first request after a cold boot, that tripped Node's
// MaxListenersExceededWarning ("11 error listeners added"). One shared promise =
// one listener pair, regardless of how many subsystems await readiness.
let readyPromise: Promise<Redis | null> | null = null;
export async function redisReady(): Promise<Redis | null> {
  const c = getRedis();
  if (!c) return null;
  if (c.status === "ready") return c;
  if (readyPromise) return readyPromise;
  readyPromise = new Promise<Redis | null>((resolve) => {
    const onReady = () => { cleanup(); resolve(c); };
    const onErr = () => { cleanup(); resolve(null); };
    const timer = setTimeout(() => { cleanup(); resolve(null); }, READY_TIMEOUT_MS);
    function cleanup() {
      clearTimeout(timer);
      c?.off("ready", onReady);
      c?.off("error", onErr);
      // Reset so a later disconnect/reconnect cycle can be awaited afresh.
      readyPromise = null;
    }
    c.once("ready", onReady);
    c.once("error", onErr);
    // Nudge the client to start connecting if it hasn't yet (lazy mode).
    void c.connect().catch(() => { /* swallowed; error event handles it */ });
  });
  return readyPromise;
}
