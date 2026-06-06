import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/lib/prisma";
import { deleteAccount } from "@/server/services/account";
import { requireCronSecret } from "@/server/lib/bearer-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/// Account-purge cron (Vercel). fix(audit purge-cron-stale-doc): the PRODUCTION
/// self-service delete (apps/web .../account/delete → deleteAccount()) is an
/// IMMEDIATE, irreversible HARD delete — it sets no deletedAt and there is NO
/// 30-day recoverable grace window (the privacy policy now says so). So the
/// soft-delete sweep below is a BACKSTOP, not the primary path: it only catches
/// rows where User.deletedAt was set by the LEGACY Express stack (apps/api
/// .../auth.service.ts softDeleteAccount), which the production web UI does not
/// call. In a web-only deployment that branch finds nothing; the useful work in
/// production is purgeStaleAnonAccounts() (reaping content-free
/// device-*@travelsafe.local accounts past the retention window).
///
/// Any elapsed-grace soft-deleted account it DOES find is run through the same
/// deleteAccount() cascade the self-service hard-delete uses, which also del()s
/// the user's uploaded photos from public Blob storage. Lives on the web/Vercel
/// side because that's where the Blob token + the cascade are, and web + API
/// share the Neon database. Same CRON_SECRET Bearer auth as other /api/cron/*.
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

// fix(audit auth-anon-account-accumulation-4): how old a content-free anonymous
// device account must be before it's reaped. Default 90 days.
const DEFAULT_ANON_RETENTION_DAYS = 90;
function anonRetentionDays(): number {
  const n = Number.parseInt(process.env.ANON_RETENTION_DAYS ?? "", 10);
  if (!Number.isFinite(n) || n < 7 || n > 730) return DEFAULT_ANON_RETENTION_DAYS;
  return n;
}

// fix(audit audit-retention-railway-dependency): SecurityAuditLog rows store
// email + IP + user-agent (written by the WEB stack on account.export/.delete).
// The only pruner was an in-process setInterval in the Railway Express service,
// so the privacy policy's "90-day retention" promise (GDPR Art. 5(1)(e)) silently
// failed whenever Railway was paused/out-of-sync. Folded into this daily Vercel
// cron (rather than a 4th cron entry — the plan's cron budget is limited) so
// retention is enforced independently of the Railway service's liveness. Mirrors
// the worker's bound exactly (7–730d) and is idempotent with it (deleteMany on an
// already-pruned range is a no-op).
const DEFAULT_AUDIT_RETENTION_DAYS = 90;
function auditRetentionDays(): number {
  const n = Number.parseInt(process.env.SECURITY_AUDIT_RETENTION_DAYS ?? "", 10);
  if (!Number.isFinite(n) || n < 7 || n > 730) return DEFAULT_AUDIT_RETENTION_DAYS;
  return n;
}

/// Reap OLD, CONTENT-FREE anonymous accounts. Every device that visits mints a
/// permanent `device-*@travelsafe.local` User row (see /api/auth/anonymous); the
/// soft-delete purge never touches them because they have no deletedAt, so
/// without this they accumulate forever. We only delete anon rows older than the
/// retention window AND with ZERO references in either direction (no posts/
/// comments/reactions/reports/contacts/timers/live-shares/saved-places/push-subs/
/// blocks/mutes/audits/etc.) — so the delete never trips an FK, and a still-active
/// device whose row carried nothing simply re-bootstraps a fresh anon session on
/// its next visit (transparent). Bounded per run like the soft-delete pass.
async function purgeStaleAnonAccounts(limit: number): Promise<{ candidates: number; purged: number }> {
  const cutoff = new Date(Date.now() - anonRetentionDays() * 24 * 60 * 60 * 1000);
  const candidates = await prisma.user.findMany({
    where: {
      email: { startsWith: "device-", endsWith: "@travelsafe.local" },
      mfaEnabled: false,
      deletedAt: null,
      createdAt: { lt: cutoff },
      posts: { none: {} },
      postReviews: { none: {} },
      postEdits: { none: {} },
      postComments: { none: {} },
      postReactions: { none: {} },
      reportsFiled: { none: {} },
      acknowledgements: { none: {} },
      trustedContacts: { none: {} },
      checkInTimers: { none: {} },
      liveShareLinks: { none: {} },
      savedPlaces: { none: {} },
      pushSubscriptions: { none: {} },
      reviewActions: { none: {} },
      blocking: { none: {} },
      blockedBy: { none: {} },
      mutes: { none: {} },
      mutedBy: { none: {} },
      suspensionEvents: { none: {} },
      securityAudits: { none: {} },
      alertPreference: { is: null },
    },
    select: { id: true },
    take: limit,
  });
  if (candidates.length === 0) return { candidates: 0, purged: 0 };
  const { count } = await prisma.user.deleteMany({
    where: { id: { in: candidates.map((c) => c.id) } },
  });
  return { candidates: candidates.length, purged: count };
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

  // Second pass: reap abandoned anonymous device accounts (separate retention
  // window, content-free only). Isolated in a try so a failure here can't fail
  // the soft-delete purge that enforces the 30-day privacy promise.
  let anon = { candidates: 0, purged: 0, error: null as string | null };
  try {
    const r = await purgeStaleAnonAccounts(BATCH);
    anon = { ...r, error: null };
  } catch (e) {
    anon.error = (e as Error)?.message?.slice(0, 160) ?? "unknown";
  }

  // Third pass: enforce SecurityAuditLog retention (Railway-independent backstop;
  // see auditRetentionDays comment). Isolated so a failure can't fail the purges.
  const auditLog = { deleted: 0, retentionDays: auditRetentionDays(), error: null as string | null };
  try {
    const auditCutoff = new Date(Date.now() - auditRetentionDays() * 24 * 60 * 60 * 1000);
    const { count } = await prisma.securityAuditLog.deleteMany({
      where: { createdAt: { lt: auditCutoff } },
    });
    auditLog.deleted = count;
  } catch (e) {
    auditLog.error = (e as Error)?.message?.slice(0, 160) ?? "unknown";
  }

  return NextResponse.json({
    ok: errors.length === 0 && !anon.error && !auditLog.error,
    generatedAt: new Date().toISOString(),
    graceDays: days,
    cutoff: cutoff.toISOString(),
    candidates: stale.length,
    purged,
    // When we hit the batch cap there may be more to do; the next daily run
    // (or a manual re-trigger) continues from the new cutoff set.
    drained: stale.length < BATCH && anon.candidates < BATCH,
    errors,
    anonAccounts: { retentionDays: anonRetentionDays(), ...anon },
    auditLog,
    totalMs: Date.now() - startedAt,
  });
}
