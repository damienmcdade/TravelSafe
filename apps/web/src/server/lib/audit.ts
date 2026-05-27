import "server-only";
import type { NextRequest } from "next/server";
import { prisma } from "./prisma";

// v95p10 — Web-side mirror of apps/api/src/lib/audit.ts. The Express
// API already records auth/registration/refresh/moderation events to
// SecurityAuditLog. DSAR-class events (account.export, account.delete)
// land on the Vercel side and were going unaudited — violating the
// AU-2/AU-3 spirit (every security-relevant action must produce a
// tamper-evident record) and breaking the accountability story for
// GDPR Article 30 (records of processing activities) and CCPA
// §1798.130(a)(3) (12-month log of consumer requests).
//
// Same fail-soft / write-once semantics as the API helper: the
// audit write is fire-and-forget, never blocks the caller. A failed
// write logs to stderr and is dropped — better to lose one log line
// than to fail the user's deletion / export request.

export type SecurityEvent =
  | "account.export"
  | "account.delete";

interface AuditOpts {
  event: SecurityEvent;
  userId?: string | null;
  email?: string | null;
  req?: NextRequest;
  detail?: Record<string, unknown>;
}

function ipFromRequest(req: NextRequest | undefined): string | null {
  if (!req) return null;
  // Vercel sets x-forwarded-for; trust the first hop. NextRequest.ip
  // exists in some runtimes but not all, so we read the header directly.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip") || null;
}

export function writeSecurityAudit(opts: AuditOpts): void {
  const { event, userId, email, req, detail } = opts;
  const ip = ipFromRequest(req);
  const userAgent = req?.headers.get("user-agent") ?? null;
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
