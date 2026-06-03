import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "./env";

// fix(audit pentest-secrets-2): constant-time string compare for the shared
// secret. Plain `===` short-circuits on the first differing byte (timing side
// channel). timingSafeEqual requires equal-length buffers, so length-mismatch is
// handled first (its own early-out leaks only the length, not content).
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Shared Bearer-secret gate used by /api/cron/* and /api/diag/* — any
// route that should be reachable only by Vercel platform crons and
// authorized operators, not by anonymous traffic. Returns a NextResponse
// on failure (which the caller should return as-is); returns null when
// the request is authorized so the route can continue.
//
// Earlier versions exposed a `softMode` flag that accepted the secret
// in a `?secret=...` query string for browser-friendly debugging. The
// audit caught that this leaks the secret into every CDN access log,
// browser history, and Referer header on outbound link clicks (the
// boston diag returns external URLs that the browser may then fetch).
// Removed. Diag routes are now hit via curl with an explicit
// Authorization header.
export function requireCronSecret(req: NextRequest): NextResponse | null {
  // If the secret isn't configured we deliberately FAIL CLOSED — return
  // 503 rather than silently allowing the request through. A missing
  // secret means the protection isn't real, and "missing config" is a
  // different state from "configured and refused".
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_secret_required" }, { status: 503 });
  }
  const header = req.headers.get("authorization");
  if (header && safeEqual(header, `Bearer ${env.CRON_SECRET}`)) return null;
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
