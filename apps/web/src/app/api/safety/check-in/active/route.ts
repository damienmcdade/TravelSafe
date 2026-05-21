import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { listActive } from "@/server/services/safety/check-in";

export const dynamic = "force-dynamic";
export const GET = wrap(async (req: NextRequest) => {
  const session = requireSession(req);
  return NextResponse.json(await listActive(session.uid));
});
