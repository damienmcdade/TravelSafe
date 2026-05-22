import { NextResponse } from "next/server";
import { aiConfigured, getAIModel } from "@/server/services/ai/provider";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const configured = aiConfigured();
  if (!configured) return NextResponse.json({ configured: false });

  let modelOk = false;
  let modelError: string | null = null;
  let sample: string | null = null;
  try {
    const model = await getAIModel();
    if (!model) throw new Error("getAIModel returned null despite aiConfigured=true");
    modelOk = true;
    const { generateText } = await import("ai");
    const res = await generateText({
      model: model as Parameters<typeof generateText>[0]["model"],
      prompt: "Reply with exactly: AI is alive.",
    });
    sample = res.text;
  } catch (err) {
    modelError = `${(err as Error).name}: ${(err as Error).message}`;
  }
  return NextResponse.json({ configured, modelOk, modelError, sample });
}
