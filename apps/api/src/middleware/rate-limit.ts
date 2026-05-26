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
