import { NextResponse } from "next/server";
import { wrap } from "@/server/lib/http";
import { getNwsAlerts, type OfficialAlert } from "@/server/services/official-alerts/nws";
import { getUsgsEarthquakes } from "@/server/services/official-alerts/usgs";
import { CITIES } from "@/lib/use-city";

export const dynamic = "force-dynamic";

/// Aggregates every supported official-alerts source for the user's
/// city. Each adapter is independent and degrades silently — if
/// USGS errors we still ship the NWS list and vice versa, so the
/// card never goes blank because one upstream is down.
export const GET = wrap(async (req: Request) => {
  const url = new URL(req.url);
  const citySlug = url.searchParams.get("city");
  const city = citySlug ? CITIES.find((c) => c.slug === citySlug) ?? null : null;

  const [nws, usgs] = await Promise.all([
    getNwsAlerts(city?.state ?? null, city?.label ?? null),
    getUsgsEarthquakes(city?.centroid ?? null),
  ]);

  // Newest first. USGS publishes precise event times; NWS publishes
  // "effective" timestamps that are usually wall-clock now or near.
  // A simple chronological merge gives the most recently-relevant
  // items at the top of the list, regardless of source.
  const alerts: OfficialAlert[] = [...nws, ...usgs].sort(
    (a, b) => +new Date(b.effective) - +new Date(a.effective),
  );

  // Sources list reflects which adapters CONTRIBUTED, not the full
  // catalog — keeps the card honest about today's data shape. The
  // catalog itself stays visible in the disclaimer.
  const sourceLabels: string[] = [];
  if (nws.length > 0) sourceLabels.push("National Weather Service");
  if (usgs.length > 0) sourceLabels.push("USGS Earthquakes");
  if (sourceLabels.length === 0) sourceLabels.push("National Weather Service", "USGS Earthquakes");

  return NextResponse.json({
    sources: sourceLabels,
    alerts,
    disclaimer:
      "Aggregated from the National Weather Service (active weather alerts) " +
      "and USGS Earthquakes (M2.5+ within 300km, past 72h). Independent of " +
      "TravelSafe community posts.",
  });
});
