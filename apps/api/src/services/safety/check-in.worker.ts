import { prisma } from "../../lib/prisma.js";
import { CheckInStatus } from "../../generated/prisma/client.js";
import { env } from "../../env.js";
import { triggerExpiry } from "./check-in.service.js";

let timer: NodeJS.Timeout | null = null;
// v96 — backpressure flag. The 30 s tick was firing again before the
// prior tick finished claiming + notifying its batch of 100 expired
// timers (notifyContact does email + webpush per contact, easily
// minutes on a slow SMTP). Without inFlight, both ticks read the
// same ACTIVE rows. triggerExpiry now atomically claims, so the
// notification can't double-fire — but the redundant tick still
// burns DB I/O. inFlight keeps things clean.
let inFlight = false;

async function tick() {
  if (inFlight) return;
  inFlight = true;
  try {
    const due = await prisma.checkInTimer.findMany({
      where: { status: CheckInStatus.ACTIVE, scheduledFor: { lte: new Date() } },
      select: { id: true },
      take: 100,
    });
    for (const { id } of due) {
      const receipts = await triggerExpiry(id);
      console.log(`[checkin-worker] fired ${id} -> ${receipts.length} delivery receipts`);
    }
  } catch (err) {
    // v105 — transient Neon-pooler connection blips (ETIMEDOUT / ECONNRESET /
    // Prisma P1001/P1002/P1017) self-heal on the next 30s tick. Log those as a
    // warning so they don't trip error monitoring (Sentry) for a non-event;
    // anything else is a genuine error worth surfacing. (The deployment-log
    // audit saw exactly one such ETIMEDOUT — graceful, but noisy as an error.)
    const e = err as { message?: string; code?: string };
    const sig = `${e?.code ?? ""} ${e?.message ?? ""}`;
    if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|can't reach database|connection (pool|terminated)|P10(01|02|17)/i.test(sig)) {
      console.warn("[checkin-worker] transient DB blip, retrying next tick:", (e?.code || e?.message || "").slice(0, 120));
    } else {
      console.error("[checkin-worker] tick failed:", err);
    }
  } finally {
    inFlight = false;
  }
}

export function startCheckInWorker() {
  if (timer) return;
  const intervalMs = Math.max(5, env.CHECKIN_WORKER_INTERVAL_SECONDS) * 1000;
  console.log(`[checkin-worker] starting (every ${intervalMs / 1000}s)`);
  timer = setInterval(() => {
    tick().catch((err) => console.error("[checkin-worker] tick threw:", err));
  }, intervalMs);
  tick().catch((err) => console.error("[checkin-worker] boot tick threw:", err));
}

export function stopCheckInWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
