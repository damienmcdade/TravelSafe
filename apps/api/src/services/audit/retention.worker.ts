import { prisma } from "../../lib/prisma.js";

// v95p11 — SecurityAuditLog retention worker.
//
// GDPR Article 5(1)(e) requires personal data to be "kept in a form
// which permits identification of data subjects for no longer than is
// necessary for the purposes for which the personal data are
// processed." Our audit log contains email, IP, and user-agent —
// retaining indefinitely would breach that minimization principle.
//
// NIST SP 800-53 AU-11 (Audit Record Retention) likewise expects an
// explicit retention period, not implicit "forever."
//
// Policy: 90 days. Long enough to reconstruct a credential-stuffing
// burst or trace a single user's deletion request through the
// compliance window (CCPA §1798.130 12-month requirement is met by
// the operator's own DB backups; the live SecurityAuditLog table
// only needs the active investigation window).
//
// Override via SECURITY_AUDIT_RETENTION_DAYS env.

const DEFAULT_RETENTION_DAYS = 90;
// Run once per day. Picks up at start, then every 24h. A
// missed-fire after a 23.5h restart still completes ~daily on
// average — the absolute cutoff timestamp moves forward with each
// tick, not by the tick interval.
const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function retentionDays(): number {
  const env = process.env.SECURITY_AUDIT_RETENTION_DAYS;
  if (!env) return DEFAULT_RETENTION_DAYS;
  const n = Number.parseInt(env, 10);
  // Sanity bound: 7 days (debugging window) to 730 days (regulated
  // sectors).
  if (!Number.isFinite(n) || n < 7 || n > 730) return DEFAULT_RETENTION_DAYS;
  return n;
}

async function pruneOnce(): Promise<{ deleted: number; cutoff: Date }> {
  const days = retentionDays();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await prisma.securityAuditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { deleted: result.count, cutoff };
}

// fix(audit api-code-1): softDeleteAccount() documents that "the retention worker
// hard-deletes any row whose deletedAt is past the grace window" — but no such
// sweep existed, so Express-soft-deleted accounts kept their PII (trusted
// contacts, check-in coords, posts) indefinitely, contradicting the GDPR
// erasure promise. This sweep hard-deletes them past the grace window, clearing
// the RESTRICT-FK rows first (same order as the web account.ts hard-delete) so
// the cascade can complete. Each user runs in its own transaction so one bad row
// can't block the rest.
const PURGE_GRACE_DAYS = (() => {
  const n = Number.parseInt(process.env.ACCOUNT_PURGE_GRACE_DAYS ?? "", 10);
  return Number.isFinite(n) && n >= 1 && n <= 365 ? n : 30;
})();

async function purgeSoftDeletedUsers(): Promise<number> {
  const cutoff = new Date(Date.now() - PURGE_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const due = await prisma.user.findMany({
    where: { deletedAt: { not: null, lt: cutoff } },
    select: { id: true },
    take: 200,
  });
  let purged = 0;
  for (const { id } of due) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.postReviewAction.deleteMany({ where: { reviewerId: id } });
        await tx.postReport.deleteMany({ where: { reporterId: id } });
        await tx.postAcknowledgement.deleteMany({ where: { userId: id } });
        await tx.postEdit.deleteMany({ where: { editorId: id } });
        await tx.postReaction.deleteMany({ where: { userId: id } });
        await tx.postComment.deleteMany({ where: { authorId: id } });
        await tx.post.updateMany({ where: { reviewerId: id }, data: { reviewerId: null } });
        await tx.post.deleteMany({ where: { authorId: id } });
        await tx.user.delete({ where: { id } });
      }, { timeout: 30_000 });
      purged += 1;
    } catch (err) {
      console.warn(`[account-purge] failed to hard-delete user ${id}:`, (err as Error).message);
    }
  }
  return purged;
}

export function startAuditRetentionWorker(): void {
  // v96 — backpressure: if a prior prune is still running when the
  // next tick fires (rare with a 24h cycle, but possible on a very
  // large audit table or a restart-loop scenario), skip rather than
  // run two concurrent deleteMany's that contend on the same rows.
  let inFlight = false;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const { deleted, cutoff } = await pruneOnce();
      if (deleted > 0) {
        console.log(`[audit-retention] pruned ${deleted} audit rows older than ${cutoff.toISOString()}`);
      }
      // fix(audit api-code-1): also hard-delete soft-deleted accounts past grace.
      const purged = await purgeSoftDeletedUsers();
      if (purged > 0) {
        console.log(`[account-purge] hard-deleted ${purged} account(s) past the ${PURGE_GRACE_DAYS}d grace window`);
      }
    } catch (err) {
      console.warn("[audit-retention] prune failed:", (err as Error).message);
    } finally {
      inFlight = false;
    }
  };
  console.log(`[audit-retention] starting (retention=${retentionDays()}d, tick every ${TICK_INTERVAL_MS / 1000}s)`);
  // First tick after a short delay so it doesn't run during cold-start.
  setTimeout(() => {
    tick().catch((err) => console.error("[audit-retention] boot tick threw:", err));
  }, 30 * 1000);
  setInterval(() => {
    tick().catch((err) => console.error("[audit-retention] tick threw:", err));
  }, TICK_INTERVAL_MS);
}
