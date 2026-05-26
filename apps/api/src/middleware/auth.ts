import type { Request, Response, NextFunction } from "express";
import { verifySession, type SessionPayload } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: SessionPayload;
    }
  }
}

// v93p2 — short-lived in-process tokenVersion cache. Without this, the
// requireAuth path adds a DB roundtrip on every authenticated request
// purely to check the revocation cursor. 30s TTL is short enough that
// revoke (password change / logout) propagates inside a minute while
// keeping the request hot-path snappy. Keyed by uid.
const TOKEN_VERSION_CACHE = new Map<string, { ver: number; exp: number }>();
const TOKEN_VERSION_TTL_MS = 30_000;

async function isTokenRevoked(payload: SessionPayload): Promise<boolean> {
  const now = Date.now();
  const cached = TOKEN_VERSION_CACHE.get(payload.uid);
  let dbVer: number;
  if (cached && cached.exp > now) {
    dbVer = cached.ver;
  } else {
    const u = await prisma.user.findUnique({ where: { id: payload.uid }, select: { tokenVersion: true } });
    if (!u) return true;  // user deleted → token invalid
    dbVer = u.tokenVersion;
    TOKEN_VERSION_CACHE.set(payload.uid, { ver: dbVer, exp: now + TOKEN_VERSION_TTL_MS });
  }
  return (payload.ver ?? 0) < dbVer;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "missing_bearer_token" });
    return;
  }
  try {
    const payload = verifySession(header.slice("Bearer ".length), { expectType: "access" });
    if (await isTokenRevoked(payload)) {
      res.status(401).json({ error: "token_revoked" });
      return;
    }
    req.session = payload;
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.header("authorization");
  if (header?.startsWith("Bearer ")) {
    try {
      const payload = verifySession(header.slice("Bearer ".length), { expectType: "access" });
      if (!(await isTokenRevoked(payload))) req.session = payload;
    } catch {
      // ignore — endpoint is optional auth
    }
  }
  next();
}
