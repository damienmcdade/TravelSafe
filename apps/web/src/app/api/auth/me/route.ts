import { NextResponse, type NextRequest } from "next/server";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { me } from "@/server/services/auth";

export const GET = wrap(async (req: NextRequest) => {
  const session = requireSession(req);
  return NextResponse.json(await me(session.uid));
});
