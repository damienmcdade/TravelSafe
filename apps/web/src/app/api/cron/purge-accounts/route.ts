import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { deleteAccount } from "@/server/services/account";
import { requireCronSecret } from "@/server/lib/bearer-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/// Account-purge cron (Vercel). Enforces the privacy policy's "permanently
/// purged within 30 days" promise for the soft-delete path.
///
/// When a user deletes their account through the API, softDeleteAccount() sets
/// User.deletedAt and obfuscates the PII columns, but the row and its FK'd
/// records (posts, comments, contacts, timers, push subs, live-share links)
/// survive a grace window so a mis-click is recoverable and abuse trails stay
/// briefly intact. The schema explicitly defers the hard purge to "a retention
/// worker" (see packages/db/prisma/schema.prisma User.deletedAt) — this is it.
///
/// Each elapsed-grace account is run through the same deleteAccount() cascade
/// the self-service hard-delete uses, which also del()s the user's uploaded
/// photos from public Blob storage (the orphaned-photo erasure gap). Lives on
/// the web/Vercel side because that's where the Blob token + the cascade are,
/// and web + API share the Neon database, so the API-set deletedAt is visible
/// here. Same CRON_SECRET Bearer auth as the other /api/cron/* endpoints.
const DEFAULT_GRACE_DAYS = 30;
// Bound per-run work so the function fits maxDuration; the daily cron drains
// any backlog across runs. Small concurrency to keep DB/heap pressure low.
const BATCH = 100;
const CONCURRENCY = 3;

function graceDays(): number {
  const n = Number.parseInt(process.env.PURGE_GRACE_DAYS ?? "", 10);
  // Sanity bound: 1 day (testing) to 365 days.
  if (!Number.isFinite(n) || n < 1 || n > 365) return DEFAULT_GRACE_DAYS;
  return n;
}

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const startedAt = Date.now();
  const days = graceDays();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // `deletedAt < cutoff` already excludes NULLs (live accounts) by SQL
  // semantics. Uses the sparse @@index([deletedAt]).
  const stale = await prisma.user.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true },
    take: BATCH,
  });

  let purged = 0;
  const errors: { id: string; error: string }[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, stale.length) }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= stale.length) return;
        const id = stale[i].id;
        try {
          await deleteAccount(id);
          purged += 1;
        } catch (e) {
          // One bad row must not abort the batch; surface it for the next run.
          errors.push({ id, error: (e as Error)?.message?.slice(0, 160) ?? "unknown" });
        }
      }
    }),
  );

  return NextResponse.json({
    ok: errors.length === 0,
    generatedAt: new Date().toISOString(),
    graceDays: days,
    cutoff: cutoff.toISOString(),
    candidates: stale.length,
    purged,
    // When we hit the batch cap there may be more to do; the next daily run
    // (or a manual re-trigger) continues from the new cutoff set.
    drained: stale.length < BATCH,
    errors,
    totalMs: Date.now() - startedAt,
  });
}
