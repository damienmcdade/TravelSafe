import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { lookupLocation } from "@/server/services/geo/lookup";

export const dynamic = "force-dynamic";
export const GET = wrap(async (req: NextRequest) => {
  const q = z.string().min(1).max(200).parse(req.nextUrl.searchParams.get("q") ?? "");
  const result = await lookupLocation(q);
  if (!result) return NextResponse.json({ error: "no_match" }, { status: 404 });
  return NextResponse.json(result);
});
