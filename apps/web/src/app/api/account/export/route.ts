import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { exportAccount } from "@/server/services/account";
import { writeSecurityAudit } from "@/server/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/account/export — DSAR data-portability response. Returns
// every record the database holds about the authenticated user as a
// single JSON document. Forces a download via Content-Disposition so
// browsers save the file rather than rendering it inline.
export const GET = wrap(async (req: NextRequest) => {
  const session = await requireSession(req);
  const data = await exportAccount(session.uid);
  writeSecurityAudit({
    event: "account.export",
    userId: session.uid,
    email: session.email,
    req,
  });
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "no-store",
      // fix(audit legal-export-filename-brand-1): user-facing download should
      // carry the public brand, not the legacy repo name.
      "Content-Disposition": `attachment; filename="communitysafe-account-${session.uid}.json"`,
    },
  });
});
