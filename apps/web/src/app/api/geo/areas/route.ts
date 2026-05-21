import { NextResponse } from "next/server";
import { allKnownAreas } from "@/server/services/geo/lookup";

export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json(await allKnownAreas());
}
