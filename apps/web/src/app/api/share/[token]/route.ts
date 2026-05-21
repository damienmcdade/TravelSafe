import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { resolveSharedView } from "@/server/services/safety/live-share";

export const GET = wrap(async (_req: NextRequest, { params }: { params: Promise<{ token: string }> }) => {
  const { token } = await params;
  return NextResponse.json(await resolveSharedView(token));
});
