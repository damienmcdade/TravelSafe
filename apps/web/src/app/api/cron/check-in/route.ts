import { NextResponse, type NextRequest } from "next/server";
import { CheckInStatus } from "@/generated/prisma/client";
import { prisma } from "@/server/lib/prisma";
import { triggerExpiry } from "@/server/services/safety/check-in";
import { requireCronSecret } from "@/server/lib/bearer-auth";

export const dynamic = "force-dynamic";
// Vercel Cron hits this every minute (configured in vercel.json). Replaces
// the long-running worker the Express service used to run. Gated behind
// CRON_SECRET so the endpoint isn't a public trigger.
export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;
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
