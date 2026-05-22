import { NextResponse, type NextRequest } from "next/server";
import { generateAITipsForArea } from "@/server/services/safety/ai-tips";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const area = req.nextUrl.searchParams.get("area") ?? "chi-loop";
  const start = Date.now();
  let tips, error: string | null = null;
  try {
    tips = await generateAITipsForArea(area);
  } catch (err) {
    error = `${(err as Error).name}: ${(err as Error).message}`;
    tips = [];
  }
  return NextResponse.json({
    area,
    elapsedMs: Date.now() - start,
    count: tips.length,
    error,
    sample: tips.slice(0, 2),
  });
}
