import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { requireSession, requireModerator } from "@/server/lib/auth";
import { env } from "@/server/lib/env";
import { listPendingPosts } from "@/server/services/moderation/queue";

export const dynamic = "force-dynamic";
export const GET = wrap(async (req: NextRequest) => {
  const session = requireSession(req);
  requireModerator(session, env.MODERATOR_EMAILS);
  return NextResponse.json(await listPendingPosts());
});
