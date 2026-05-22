import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { getCommunitySignals } from "@/server/services/community/reddit-signals";

const Query = z.object({
  area: z.string().min(1).max(80),
});

export const dynamic = "force-dynamic";
export const GET = wrap(async (req: NextRequest) => {
  const { area } = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const { source, signals } = await getCommunitySignals(area);
  return NextResponse.json({
    area,
    source,
    signals,
    disclaimer:
      "Signals are recent thread titles from the city's main subreddit, filtered to the selected neighborhood. " +
      "TravelSafe does not endorse, moderate, or re-host the threads — click through to read them at the source. " +
      "Reddit users may post unverified claims; treat each as community-reported, not official.",
  });
});
