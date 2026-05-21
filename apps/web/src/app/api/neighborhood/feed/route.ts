import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { PostStatus } from "@prisma/client";
import { wrap, HttpError } from "@/server/lib/http";
import { prisma } from "@/server/lib/prisma";
import { crimeData } from "@/server/services/crime-data";

export const dynamic = "force-dynamic";
export const GET = wrap(async (req: NextRequest) => {
  const { neighborhood } = z.object({ neighborhood: z.string() }).parse(Object.fromEntries(req.nextUrl.searchParams));
  const area = await prisma.area.findUnique({ where: { slug: neighborhood } });
  if (!area) throw new HttpError(404, "unknown_neighborhood");

  const [posts, alerts, recent] = await Promise.all([
    prisma.post.findMany({
      where: { areaId: area.id, status: PostStatus.VERIFIED },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { author: { select: { id: true, displayName: true } }, _count: { select: { comments: true, reactions: true } } },
    }),
    crimeData.getAreaAlerts(neighborhood),
    crimeData.getRecentReports(neighborhood, { limit: 10 }),
  ]);

  return NextResponse.json({ area, posts, alerts, recent });
});
