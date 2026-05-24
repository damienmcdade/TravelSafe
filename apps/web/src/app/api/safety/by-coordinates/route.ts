import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { wrap } from "@/server/lib/http";
import { cityFromLatLng } from "@/server/services/crime-data/cities";
import { crimeData } from "@/server/services/crime-data";
import {
  FBI_NATIONAL_PER_100K_2024,
  getSafetyScore,
} from "@/server/services/watch/safety-score";

// GET /api/safety/by-coordinates?latitude=X&longitude=Y
//
// Returns the matched neighborhood, its current BlockScore, and category
// counts in the cached window. Designed for mobile clients sending raw
// lat/lng (e.g., "where am I standing?"). Response shape is intentionally
// stable so a partner app can rely on the contract:
//
//   {
//     "id": "sd-north-park",            // adapter slug (string)
//     "name": "North Park",
//     "city": "San Diego",
//     "blockScore": 88,
//     "metrics": { "violent": 2, "property": 14 },
//     "fbiComparison": "BELOW_NATIONAL_AVG"
//   }
//
// ──────────────────────────────────────────────────────────────────────
// Reference: equivalent PostGIS implementation (target enterprise schema)
// ──────────────────────────────────────────────────────────────────────
// When the data layer migrates from per-city open-data adapters to a
// pre-aggregated PostGIS table, the spatial lookup collapses to:
//
//   SELECT id, name, city, block_score, violent_crime_count,
//          property_crime_count, fbi_benchmark_comparison
//     FROM locations
//    WHERE ST_Contains(boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326))
//    LIMIT 1;
//
// with $1 = longitude, $2 = latitude (parameterized — never string-
// interpolated — to prevent SQL injection). The GIST index on `boundary`
// makes this an O(log n) lookup.
//
// The current implementation uses the same logical contract but resolves
// "which neighborhood?" via the existing adapter discovery + haversine
// nearest-area path. The response shape is identical so the migration
// is purely internal.

const Query = z.object({
  latitude:  z.coerce.number().finite(),
  longitude: z.coerce.number().finite(),
});

interface ByCoordinatesResponse {
  id: string;
  name: string;
  city: string;
  blockScore: number;
  metrics: { violent: number; property: number };
  fbiComparison: "BELOW_NATIONAL_AVG" | "NEAR_NATIONAL_AVG" | "ABOVE_NATIONAL_AVG";
  source: { label: string; url: string };
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function bandFromScore(score: number): ByCoordinatesResponse["fbiComparison"] {
  if (score >= 80) return "BELOW_NATIONAL_AVG";
  if (score >= 50) return "NEAR_NATIONAL_AVG";
  return "ABOVE_NATIONAL_AVG";
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export const GET = wrap(async (req: NextRequest) => {
  const { latitude, longitude } = Query.parse(Object.fromEntries(req.nextUrl.searchParams));

  // 1. Which city does this coordinate fall into? Uses the registered city
  //    bounding boxes — fast in-memory check, no upstream call.
  const city = cityFromLatLng({ lat: latitude, lng: longitude });
  if (!city) {
    return NextResponse.json(
      {
        error: "no_supported_city",
        message:
          "These coordinates fall outside every city TravelSafe currently tracks. Supported cities: see /api/geo/areas.",
      },
      { status: 404 },
    );
  }

  // 2. Within the city, find the nearest tracked neighborhood centroid.
  //    The discover() call hits the same adapter cache the rest of the app
  //    uses, so this is cheap on warm requests.
  const areas = await city.discover().catch(() => []);
  if (areas.length === 0) {
    return NextResponse.json(
      { error: "no_areas_loaded", message: `No neighborhoods loaded for ${city.label} right now.` },
      { status: 503 },
    );
  }
  let best: { slug: string; label: string; km: number } | null = null;
  for (const a of areas) {
    const km = haversineKm({ lat: latitude, lng: longitude }, a.centroid);
    if (!best || km < best.km) best = { slug: a.slug, label: a.label, km };
  }
  if (!best) {
    return NextResponse.json({ error: "no_nearest_area" }, { status: 404 });
  }

  // 3. Pull the matched neighborhood's BlockScore + category counts.
  const score = await getSafetyScore(best.slug, best.label);
  const violent  = score.rows.find((r) => r.category === "PERSONS")?.count  ?? 0;
  const property = score.rows.find((r) => r.category === "PROPERTY")?.count ?? 0;

  // 4. Derive the simple FBI comparison band for the response contract.
  const ratios = score.rows
    .map((r) => (r.nationalPer100k > 0 ? r.localPer100k / r.nationalPer100k : 1))
    .filter((r) => Number.isFinite(r));
  const avgRatio = ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 1;

  // BlockScore: 5–100, where 100 = near-zero reported incidents and 5 =
  // the floor for extremely incident-dense areas. Bands the response
  // surfaces as fbiComparison: ≥80 BELOW, 50-79 NEAR, <50 ABOVE.
  //
  // The previous formula decayed linearly past ratio=1 and hit the floor
  // at ratio ≈ 2.125 — meaning every dense downtown collapsed to score 5
  // regardless of whether it was 2× or 20× the national rate. Comparing
  // Times Square (5) to Pacific Beach (5) to Downtown Phoenix (5)
  // taught the user nothing. Fix: replace the upper branch with a
  // hyperbolic decay that spreads ratios 1×–20× across scores 5–50
  // without any artificial cliff.
  //
  //   ratio  →  score (new)   |  score (old)
  //   0.5      90             |  90
  //   1.0      50             |  50
  //   1.5      38             |  30
  //   2.0      31             |  10
  //   3.0      23             |   5 ← cliff
  //   5.0      15             |   5
  //   10.0      8             |   5
  //   20.0      5             |   5
  const derivedScore =
    avgRatio <= 0.5 ? 90
    : avgRatio <= 1.0 ? Math.round(100 - 50 * avgRatio)
    : Math.max(5, Math.round(50 / (1 + (avgRatio - 1) * 0.6)));
  const blockScore = Math.min(100, Math.max(5, derivedScore));

  const body: ByCoordinatesResponse = {
    id: best.slug,
    name: best.label,
    city: city.label,
    blockScore,
    metrics: { violent, property },
    fbiComparison: bandFromScore(blockScore),
    source: {
      label: `FBI Crime Data Explorer 2025 + ${city.label} police feed`,
      url: "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend",
    },
  };
  return NextResponse.json(body);
});
