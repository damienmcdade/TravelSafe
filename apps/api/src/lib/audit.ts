// v92 — security audit log helper (DISA STIG AU-2 / AU-3).
// Write-once, fail-soft: a logging failure must NEVER block the
// security-relevant action itself. Failures are logged to stderr so
// they're at least visible in the platform log stream.
import type { Request } from "express";
import { prisma } from "./prisma.js";

export type SecurityEvent =
  | "auth.login.success"
  | "auth.login.fail.bad_password"
  | "auth.login.fail.locked"
  | "auth.login.fail.banned"
  | "auth.login.fail.mfa"
  | "auth.register"
  | "auth.token.refresh"
  // v95p10 — MFA lifecycle (DISA STIG IA-2(1) requires audit of
  // authenticator-management events alongside auth events).
  | "auth.mfa.enroll"
  | "auth.mfa.enable"
  | "auth.mfa.disable"
  | "account.export"
  | "account.delete"
  | "moderation.review"
  | "moderation.suspend"
  | "moderation.ban"
  | "moderation.unban"
  | "user.role.change";

interface AuditOpts {
  event: SecurityEvent;
  userId?: string | null;
  email?: string | null;
  req?: Pick<Request, "ip" | "headers">;
  detail?: Record<string, unknown>;
}

export function writeSecurityAudit(opts: AuditOpts): void {
  // Fire-and-forget — never await. Caller's path completes immediately;
  // the audit log persists in the background.
  const { event, userId, email, req, detail } = opts;
  const ip = req?.ip ?? null;
  const userAgent = (req?.headers?.["user-agent"] as string | undefined) ?? null;
  void prisma.securityAuditLog
    .create({
      data: {
        event,
        userId: userId ?? null,
        email: email ?? null,
        ip,
        userAgent: userAgent ? userAgent.slice(0, 500) : null,
        detail: detail ? (detail as object) : undefined,
      },
    })
    .catch((err) => {
      console.error("[security-audit] write failed", { event, err: (err as Error).message });
    });
}
