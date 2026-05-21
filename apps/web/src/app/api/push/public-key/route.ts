import { NextResponse } from "next/server";
import { env } from "@/server/lib/env";

export function GET() {
  return NextResponse.json({ publicKey: env.VAPID_PUBLIC_KEY ?? null });
}
