import { NextResponse } from "next/server";
import { allKnownAreas } from "@/server/services/geo/lookup";

export function GET() {
  return NextResponse.json(allKnownAreas());
}
