import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { requireSession, requireModerator } from "@/server/lib/auth";
import { listPendingPosts } from "@/server/services/moderation/queue";

export const dynamic = "force-dynamic";
export const GET = wrap(async (req: NextRequest) => {
  const session = await requireSession(req);
  await requireModerator(session);
  return NextResponse.json(await listPendingPosts());
});
