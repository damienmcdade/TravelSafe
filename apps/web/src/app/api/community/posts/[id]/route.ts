import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { prisma } from "@/server/lib/prisma";

// fix(audit db-post-softdelete-2): the Post.deletedAt soft-delete column was
// documented + indexed but nothing ever SET it (no author delete path existed),
// so the feed filter added alongside this could never actually hide anything.
// This author-only DELETE makes the mechanism real: it marks deletedAt instead
// of hard-deleting, so the row (and its comments/reactions/reports) survive for
// moderation history and the account-retention worker, while every feed query
// (which now filters deletedAt IS NULL) stops showing it immediately. Idempotent.
export const DELETE = wrap(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession(req);
  const { id } = await params;
  const post = await prisma.post.findUnique({ where: { id }, select: { authorId: true, deletedAt: true } });
  if (!post) {
    return NextResponse.json({ error: "post_not_found" }, { status: 404 });
  }
  // Authors can delete their own posts. Moderator takedowns go through the
  // separate review pipeline (status = REJECTED), so this is intentionally
  // author-scoped — a non-author gets 403, not 404, so the contract is explicit.
  if (post.authorId !== session.uid) {
    return NextResponse.json({ error: "not_post_author" }, { status: 403 });
  }
  if (!post.deletedAt) {
    await prisma.post.update({ where: { id }, data: { deletedAt: new Date() } });
  }
  return NextResponse.json({ ok: true });
});
