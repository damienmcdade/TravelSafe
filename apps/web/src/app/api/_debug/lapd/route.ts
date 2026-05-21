import { NextResponse } from "next/server";
import { getRowsLA, getDiscoveredAreasLA } from "@/server/services/crime-data/adapters/lapd-socrata";

// Diagnostic endpoint — surfaces row counts + first error so we can see
// what's happening inside the LAPD adapter without console logs.
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET() {
  const out: Record<string, unknown> = { ts: new Date().toISOString() };
  try {
    const rows = await getRowsLA();
    out.rowCount = rows.length;
    out.firstRow = rows[0];
    out.distinctAreas = Array.from(new Set(rows.map((r) => r.area))).slice(0, 20);
    out.rowsWithLatLng = rows.filter((r) => r.lat != null && r.lng != null).length;
  } catch (e) {
    out.fetchError = (e as Error).message;
  }
  try {
    const areas = await getDiscoveredAreasLA();
    out.discoveredCount = areas.length;
    out.discoveredSample = areas.slice(0, 10);
  } catch (e) {
    out.discoverError = (e as Error).message;
  }
  return NextResponse.json(out);
}
