import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";

// Push subscription endpoints are issued by browsers and only ever
// point at a small set of well-known push services. Restricting the
// hostname blocks the attack the security audit flagged: an attacker
// could otherwise register an endpoint pointing at their own VAPID
// listener under the victim's user, then receive any push the app
// sends — which on CommunitySafe would include alert notifications
// targeted at the victim's saved areas.
//
// The list below covers the three major push gateways: Google
// (Chrome / Edge / desktop Firefox proxies through here), Mozilla
// (Firefox), and Apple (Safari on iOS 16.4+ / macOS). If a real-world
// subscription arrives from a different hostname we'll learn about it
// from the 400 response and can add it explicitly.
const ALLOWED_PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "android.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
]);

function isAllowedPushEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return ALLOWED_PUSH_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

const SubBody = z.object({
  endpoint: z.string().url().refine(isAllowedPushEndpoint, {
    message: "endpoint hostname not on the push-services allowlist",
  }),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

export const POST = wrap(async (req: NextRequest) => {
  const session = await requireSession(req);
  const sub = SubBody.parse(await req.json());
  // v106 (security audit) — the upsert previously set `userId: session.uid` in
  // BOTH create and update, so any authenticated caller who submitted an
  // endpoint that already existed reassigned it to themselves (mass-assignment
  // on the unique key). Reject a cross-account endpoint and never reassign
  // ownership on update; the browser mints a fresh endpoint on re-subscribe.
  const existing = await prisma.pushSubscription.findUnique({
    where: { endpoint: sub.endpoint },
    select: { userId: true },
  });
  if (existing && existing.userId !== session.uid) {
    return NextResponse.json({ ok: false, error: "endpoint_in_use" }, { status: 409 });
  }
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId: session.uid, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    update: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
  return NextResponse.json({ ok: true });
});

export const DELETE = wrap(async (req: NextRequest) => {
  const session = await requireSession(req);
  const { endpoint } = z.object({ endpoint: z.string().url() }).parse(await req.json());
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: session.uid } });
  return NextResponse.json({ ok: true });
});
