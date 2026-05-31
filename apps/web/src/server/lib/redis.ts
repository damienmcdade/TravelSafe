import "server-only";
import Redis from "ioredis";
import { env } from "./env";

// Shared Redis client for the web (Vercel) runtime. Mirrors the Railway API's
// apps/api/src/lib/redis.ts: lazy-initialized so the app boots cleanly when
// REDIS_URL is unset, and every consumer must handle a null client and fall
// back to its in-process path. The only web consumer today is the community
// live-update pub/sub (services/community/events.ts), which uses a SEPARATE
// connection for the subscriber (a connection in subscribe mode can't issue
// normal commands), so this module also exposes a duplicate() helper.
//
// Point REDIS_URL at the same Redis instance the Railway API uses so events
// published by either runtime reach SSE clients on the other.

let client: Redis | null = null;
let initFailed = false;

function build(): Redis {
  const c = new Redis(env.REDIS_URL as string, {
    lazyConnect: true,
    // Fail-soft: a transient Redis blip should not hang a request — let the
    // caller fall through to its in-memory path instead of retrying forever.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  c.on("error", (err) => console.warn("[redis] error:", err.message));
  return c;
}

/// Shared command/publish client. Returns null when REDIS_URL is unset or a
/// prior init threw. Connects lazily on first command.
export function getRedis(): Redis | null {
  if (client) return client;
  if (initFailed) return null;
  if (!env.REDIS_URL) return null;
  try {
    client = build();
    return client;
  } catch (err) {
    console.warn("[redis] init failed:", (err as Error).message);
    initFailed = true;
    return null;
  }
}

/// A dedicated connection for SUBSCRIBE (subscriber-mode clients can't run
/// normal commands, so pub/sub needs its own socket). Returns null when Redis
/// isn't configured.
export function getRedisSubscriber(): Redis | null {
  if (!env.REDIS_URL) return null;
  try {
    return build();
  } catch (err) {
    console.warn("[redis] subscriber init failed:", (err as Error).message);
    return null;
  }
}

export function isRedisEnabled(): boolean {
  return !!env.REDIS_URL;
}
