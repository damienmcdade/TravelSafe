import "server-only";
import { NextResponse } from "next/server";

// fix(deploy logs — Vercel 504s on heavy crime-data routes): a cold cache on a
// big city can take >60s, blowing Vercel's function ceiling and returning a hard
// 504. Race the compose against a sub-ceiling deadline and return a retryable 503
// 'warming_up' instead — the background compose keeps warming the cache and the
// client's useApi auto-retries on /warming_up/. Shared by the heavy citywide /
// area-stats / mix / upticks routes (safety-score has its own equivalent).
const DEFAULT_TIMEOUT_MS = 50_000;
const TIMEOUT = Symbol("warming-timeout");

export async function withWarmingTimeout<T>(
  compose: Promise<T>,
  ok: (value: T) => NextResponse,
  ms: number = DEFAULT_TIMEOUT_MS,
): Promise<NextResponse> {
  // fix(audit api-code-6): clear the deadline timer when `compose` wins, so a
  // fast response doesn't leave the (up to 50s) setTimeout pending on every call.
  let timer: ReturnType<typeof setTimeout>;
  const result = await Promise.race([
    compose,
    new Promise<typeof TIMEOUT>((resolve) => { timer = setTimeout(() => resolve(TIMEOUT), ms); }),
  ]).finally(() => clearTimeout(timer));
  if (result === TIMEOUT) {
    return NextResponse.json(
      { error: "warming_up", message: "Data is warming up — retry shortly." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return ok(result);
}
