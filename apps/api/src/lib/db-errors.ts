// Shared classifier for transient Neon-pooler connection blips (ETIMEDOUT /
// ECONNRESET / ECONNREFUSED / Prisma P1001/P1002/P1017 / "can't reach
// database" / connection-pool-terminated) that self-heal on a worker's next
// tick. Background workers log these as WARNINGS rather than errors so a
// non-event doesn't trip Sentry/error monitoring. Centralized so every worker
// (check-in, proximity, …) classifies identically.
export function isTransientDbError(err: unknown): boolean {
  const e = err as { message?: string; code?: string } | undefined;
  const sig = `${e?.code ?? ""} ${e?.message ?? ""}`;
  return /ETIMEDOUT|ECONNRESET|ECONNREFUSED|can't reach database|connection (pool|terminated)|P10(01|02|17)/i.test(sig);
}
