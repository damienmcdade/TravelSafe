import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({ ok: true, service: "travelsafe-web", time: new Date().toISOString() });
}
