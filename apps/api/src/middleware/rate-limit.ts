import rateLimit, { type Store } from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import type { Request } from "express";
import { getRedis, isRedisEnabled } from "../lib/redis.js";

// v111 — durable, cross-replica rate-limit counters. The limiters previously
// used express-rate-limit's default in-process MemoryStore, so every cap was
// per-instance: if Railway ever runs >1 replica, the effective limit multiplies
// by replica count (a latent scaling hole flagged by the audit). When REDIS_URL
// is set we back each limiter with the shared Redis (the same client used for
// MFA-replay + the community bus); otherwise we return undefined so
// express-rate-limit falls back to MemoryStore (local dev / Redis-less deploys).
//
// Each limiter gets a distinct key prefix so their counts never collide. Paired
// with `passOnStoreError: true` on every limiter so a transient Redis blip
// fails OPEN (request allowed) rather than 500-ing — availability over a brief
// gap in throttling, matching the rest of the Redis-fail-soft design.
function makeStore(prefix: string): Store | undefined {
  if (!isRedisEnabled()) return undefined;
  const client = getRedis();
  if (!client) return undefined;
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) =>
      client.call(command, ...args) as Promise<RedisReply>,
  });
}

// fix(security rate-limit-key): the limiters previously keyed on the default
// `req.ip`, which `trust proxy: 1` resolves to Railway's EDGE-NODE IP (a small
// 84.17.44.x pool) — NOT the client. That made the cap per-edge-node, so it
// neither limited a real client correctly nor stopped an attacker spread across
// edges. Empirically verified (/diag/whoami) that Railway's edge STRIPS any
// client-supplied X-Forwarded-For / X-Real-IP and sets `x-real-ip` to the true
// client IP — so it is non-forgeable. Key on it; fall back to `req.ip` only if
// it's ever absent (internal calls). Per-client, never a single shared bucket.
// Exported: the SSE connection caps in community.routes.ts must key on the
// same real-client IP, not `req.ip` (the edge-node IP).
export function clientIpKey(req: Request): string {
  const raw = req.headers["x-real-ip"];
  let ip = typeof raw === "string" ? raw.split(",")[0]!.trim() : "";
  if (!ip) ip = req.ip || "0.0.0.0";
  // Group IPv6 by /64 (first four hextets) so a client can't rotate the host
  // portion to evade the cap; IPv4 is keyed in full.
  if (ip.includes(":")) ip = ip.split(":").slice(0, 4).join(":") + "::/64";
  return ip;
}

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: clientIpKey,
  store: makeStore("auth"),
  passOnStoreError: true,
});

export const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: clientIpKey,
  store: makeStore("write"),
  passOnStoreError: true,
});

// v92 — global per-IP DoS protection on every API route (DISA STIG
// SC-5). Pre-v92 only /auth had express-rate-limit; the rest of the
// API (safezone, crime-data, geo, ai, share, etc.) was unguarded
// against a single client flooding requests. 600 req/min/IP leaves
// headroom for the v62-introduced tryProxy from Vercel (which fans
// many user requests through a small number of Vercel IPs) while
// still bounding a single direct attacker.
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: clientIpKey,
  store: makeStore("global"),
  passOnStoreError: true,
  // Don't 429 on health checks (Railway probes every 30s) or diag.
  skip: (req) => req.path === "/health" || req.path === "/healthz" || req.path.startsWith("/diag/"),
});

// v96 — per-token throttle for endpoints that validate a secret in
// the URL (contact confirmation, share redemption). Tokens are
// 192-bit random so practically unguessable, but defense-in-depth:
// if a token ever leaks via a log or referrer it shouldn't be
// brute-forceable into a working confirmation. 10/min per-token is
// tight enough to defeat scripted abuse without blocking a user who
// double-clicks the email link.
export const tokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `token:${req.params.token ?? clientIpKey(req)}`,
  store: makeStore("token"),
  passOnStoreError: true,
});

// v96 — pen-test follow-up. Anonymous LLM endpoints (the AI brief +
// incident summary GETs) previously only had the 600 req/min/IP
// global limit, so a single attacker could burn ~600 LLM calls/min
// from one IP. The 300s public cache deflects repeat queries for
// the SAME area, but `?area=` varies by attacker control. 30/min/IP
// matches the writeLimiter envelope while still letting a normal
// session hit the brief for every neighborhood on the map without
// being throttled.
export const aiReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: clientIpKey,
  store: makeStore("airead"),
  passOnStoreError: true,
});
