import { NextResponse } from "next/server";
import { wrap } from "@/server/lib/http";
import { getCoverage } from "@/server/services/coverage/status";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// v95p45 — bumped from s-maxage=300 to 1800 (30 min) so the warmed
// dashboard stays hot across page refreshes during a typical browsing
// session. The underlying adapter row caches refresh on a 5-min TTL,
// but the coverage *summary* (neighborhood counts, freshness signals)
// changes glacially — most cities update once a day. stale-while-
// revalidate=3600 keeps the response instant even when the cache age
// pushes past 30 minutes; a fresh probe runs in the background.
const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600",
};

export const GET = wrap(async () => {
  const coverage = await getCoverage();
  return NextResponse.json(coverage, { headers: CACHE_HEADERS });
});
