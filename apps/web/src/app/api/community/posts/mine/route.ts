import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";

export const dynamic = "force-dynamic";
export const GET = wrap(async (req: NextRequest) => {
  const session = await requireSession(req);
  const posts = await prisma.post.findMany({
    // fix(audit db-post-softdelete-2): a soft-deleted post is gone for the author too.
    where: { authorId: session.uid, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { flags: true, area: true },
    // fix(audit db-unbounded-mine-5): cap the result set. A prolific author (or a
    // scripted spammer) could otherwise pull an unbounded list into memory + the
    // response. 200 is well above any real per-author post count.
    take: 200,
  });
  return NextResponse.json(posts);
});
