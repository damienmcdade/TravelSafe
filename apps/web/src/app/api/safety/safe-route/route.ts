import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { requireSession } from "@/server/lib/auth";
import { planSafeRoute } from "@/server/services/safety/safe-route";

const Body = z.object({
  from: z.object({ lat: z.number(), lng: z.number() }),
  to:   z.object({ lat: z.number(), lng: z.number() }),
});

export const POST = wrap(async (req: NextRequest) => {
  requireSession(req);
  const { from, to } = Body.parse(await req.json());
  return NextResponse.json(await planSafeRoute(from, to));
});
