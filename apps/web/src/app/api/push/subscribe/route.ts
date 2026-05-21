import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";

const SubBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

export const POST = wrap(async (req: NextRequest) => {
  const session = requireSession(req);
  const sub = SubBody.parse(await req.json());
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId: session.uid, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    update: { userId: session.uid, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
  return NextResponse.json({ ok: true });
});

export const DELETE = wrap(async (req: NextRequest) => {
  const session = requireSession(req);
  const { endpoint } = z.object({ endpoint: z.string().url() }).parse(await req.json());
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: session.uid } });
  return NextResponse.json({ ok: true });
});
