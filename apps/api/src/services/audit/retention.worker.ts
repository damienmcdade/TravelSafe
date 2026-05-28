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
        console.log(`[audit-retention] pruned ${deleted} rows older than ${cutoff.toISOString()}`);
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
