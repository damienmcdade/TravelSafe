import { NextResponse } from "next/server";
import { bostonSnapshot } from "@/server/data/boston-snapshot";
import { getRowsBoston, getDiscoveredAreasBoston } from "@/server/services/crime-data/adapters/boston-ckan";
import { env } from "@/server/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  // Pipeline trace: snapshot → adapter rows → discovered areas → env state.
  const rows = await getRowsBoston().catch((e) => ({ error: String(e) }));
  const areas = await getDiscoveredAreasBoston().catch((e) => ({ error: String(e) }));

  // env.* values — just the *presence* (true/false), never the values themselves.
  const envPresence = {
    GOOGLE_GENERATIVE_AI_API_KEY: Boolean(env.GOOGLE_GENERATIVE_AI_API_KEY),
    GEMINI_API_KEY: Boolean(env.GEMINI_API_KEY),
    GOOGLE_API_KEY: Boolean(env.GOOGLE_API_KEY),
    AI_GATEWAY_API_KEY: Boolean(env.AI_GATEWAY_API_KEY),
    BOSTON_PROXY_URL: Boolean(env.BOSTON_PROXY_URL),
  };

  return NextResponse.json({
    snapshot: {
      available: true,
      generatedAt: bostonSnapshot.generated_at,
      count: bostonSnapshot.count,
      newest: bostonSnapshot.newest,
      oldest: bostonSnapshot.oldest,
    },
    rowsFromGetRows: Array.isArray(rows) ? { length: rows.length, firstArea: rows[0]?.area, firstLat: rows[0]?.lat, firstLng: rows[0]?.lng } : rows,
    areasFromDiscover: Array.isArray(areas) ? { length: areas.length, samples: areas.slice(0, 3) } : areas,
    env: envPresence,
  });
}
