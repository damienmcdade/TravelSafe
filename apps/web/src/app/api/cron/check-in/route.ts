import { NextResponse, type NextRequest } from "next/server";
import { CheckInStatus } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";
import { triggerExpiry } from "@/server/services/safety/check-in";
import { env } from "@/server/lib/env";

export const dynamic = "force-dynamic";
// Vercel Cron hits this every minute (configured in vercel.json). Replaces
// the long-running worker the Express service used to run. If CRON_SECRET is
// set, require it as a Bearer header so the endpoint isn't a public trigger.
export async function GET(req: NextRequest) {
  // CRON_SECRET is REQUIRED — see /api/cron/audit-ratios for rationale.
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: "cron_secret_required" }, { status: 503 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const due = await prisma.checkInTimer.findMany({
    where: { status: CheckInStatus.ACTIVE, scheduledFor: { lte: new Date() } },
    select: { id: true },
    take: 50,
  });
  const fired: string[] = [];
  for (const { id } of due) {
    await triggerExpiry(id);
    fired.push(id);
  }
  return NextResponse.json({ ok: true, fired: fired.length, ids: fired });
}
