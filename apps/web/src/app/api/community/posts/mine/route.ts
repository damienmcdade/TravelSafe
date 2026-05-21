import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";

export const dynamic = "force-dynamic";
export const GET = wrap(async (req: NextRequest) => {
  const session = requireSession(req);
  const posts = await prisma.post.findMany({
    where: { authorId: session.uid },
    orderBy: { createdAt: "desc" },
    include: { flags: true, area: true },
  });
  return NextResponse.json(posts);
});
