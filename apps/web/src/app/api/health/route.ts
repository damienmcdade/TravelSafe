import { NextResponse } from "next/server";
import { prisma } from "@/server/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// /api/health — real health probe for Vercel + external uptime monitors.
// Returns 200 when the app process is responsive AND can talk to Postgres,
// 503 when the DB ping fails (the most common real-world outage we
// actually want to page on). Body always includes a `checks` object so
// monitors can render the specific failure rather than just "down".
export async function GET() {
  const checks: Record<string, { ok: boolean; ms?: number; error?: string }> = {};
  let httpStatus = 200;

  // Database round-trip. The simplest possible query that exercises the
  // pool, network, and Postgres process. If the pool is exhausted or
  // Postgres is down this is what will surface it.
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = { ok: true, ms: Date.now() - dbStart };
  } catch (err) {
    checks.db = { ok: false, ms: Date.now() - dbStart, error: (err as Error).message };
    httpStatus = 503;
  }

  return NextResponse.json(
    {
      ok: httpStatus === 200,
      service: "travelsafe-web",
      // Vercel injects VERCEL_GIT_COMMIT_SHA at build time so monitors
      // can correlate a failing health check back to a specific commit.
      // Falls back to null in local / non-Vercel environments.
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      env: process.env.VERCEL_ENV ?? "local",
      time: new Date().toISOString(),
      checks,
    },
    {
      status: httpStatus,
      // Health checks are polled — never let any layer cache them or
      // a once-broken response would persist past the actual outage.
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    },
  );
}
