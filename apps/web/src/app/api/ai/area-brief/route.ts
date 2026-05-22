import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { generateAreaBrief } from "@/server/services/ai/area-brief";

const Query = z.object({
  area: z.string().min(1).max(80),
});

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = wrap(async (req: NextRequest) => {
  const { area } = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const brief = await generateAreaBrief(area);
  return NextResponse.json({
    area,
    brief,
    aiConfigured: brief !== null,
    disclaimer:
      "AI-generated summary grounded in the most-reported offenses for this area. " +
      "Not legal or medical advice. Treat as a starting point for awareness, not a verdict.",
  });
});
