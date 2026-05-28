import rateLimit from "express-rate-limit";

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

export const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
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
  keyGenerator: (req) => `token:${req.params.token ?? req.ip}`,
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
});
