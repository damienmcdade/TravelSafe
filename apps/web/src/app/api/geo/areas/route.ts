import { NextResponse } from "next/server";
import { allKnownAreas } from "@/server/services/geo/lookup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET() {
  return NextResponse.json(await allKnownAreas());
}
