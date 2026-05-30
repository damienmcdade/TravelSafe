import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CrimeCategory, NotificationFrequency } from "@/generated/prisma/client";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";

const Body = z.object({
  categories: z.array(z.nativeEnum(CrimeCategory)).min(0).max(3),
  pushMinRiskLevel: z.number().int().min(1).max(5).default(3),
  notificationFrequency: z.nativeEnum(NotificationFrequency).default(NotificationFrequency.DIGEST_DAILY),
  notificationDailyCap: z.number().int().min(1).max(10).default(3),
});

export const GET = wrap(async (req: NextRequest) => {
  const session = requireSession(req);
  const pref = await prisma.alertPreference.findUnique({ where: { userId: session.uid } });
  return NextResponse.json(pref ?? { categories: [], pushMinRiskLevel: 3, notificationFrequency: "DIGEST_DAILY", notificationDailyCap: 3 });
});

export const PUT = wrap(async (req: NextRequest) => {
  const session = requireSession(req);
  const data = Body.parse(await req.json());
  const pref = await prisma.alertPreference.upsert({
    where: { userId: session.uid },
    create: { userId: session.uid, ...data },
    update: data,
  });
  return NextResponse.json(pref);
});
