import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap, HttpError } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";

export const POST = wrap(async (req: NextRequest) => {
  const session = await requireSession(req);
  const { userId } = z.object({ userId: z.string() }).parse(await req.json());
  if (userId === session.uid) throw new HttpError(400, "cannot_mute_self");
  await prisma.userMute.upsert({
    where: { muterId_mutedId: { muterId: session.uid, mutedId: userId } },
    create: { muterId: session.uid, mutedId: userId },
    update: {},
  });
  return NextResponse.json({ ok: true });
});
