import { NextResponse } from "next/server";
import { wrap } from "@/server/lib/http";
import { getNwsAlerts, type OfficialAlert } from "@/server/services/official-alerts/nws";
import { getUsgsEarthquakes } from "@/server/services/official-alerts/usgs";
import { getAmberAlerts } from "@/server/services/official-alerts/amber";
import { getStateTraffic, trafficAgencyForState } from "@/server/services/official-alerts/state-traffic";
import { OFFICIAL_ALERTS_CITY_META } from "@/server/services/official-alerts/city-meta";

export const dynamic = "force-dynamic";

/// Aggregates every supported official-alerts source for the user's
/// city. Each adapter is independent and degrades silently — if
/// USGS errors we still ship the NWS list and vice versa, so the
/// card never goes blank because one upstream is down.
export const GET = wrap(async (req: Request) => {
  const url = new URL(req.url);
  const citySlug = url.searchParams.get("city");
  // City lookup is intentionally against a server-safe meta map. We
  // can't import the client-bundle CITIES (use-city.ts is
  // "use client"); doing so threw at runtime under Fluid Compute.
  const city = citySlug ? OFFICIAL_ALERTS_CITY_META[citySlug] ?? null : null;

  // v95p19 — AMBER alerts join NWS + USGS. AMBER is filtered by the
  // user's state (not city) because abductions move across cities.
  // Road conditions: each state routes to its own highway-patrol / DOT feed
  // (California → CHP, and a per-state ArcGIS registry for the rest). Returns
  // [] for states without a free public feed. roadAgency names the source even
  // when there are zero active incidents, so the card can show a populated
  // "no active incidents" state rather than going blank.
  const roadAgency = trafficAgencyForState(city?.state ?? null);
  const [nws, usgs, amber, traffic] = await Promise.all([
    getNwsAlerts(city?.state ?? null, city?.label ?? null, city?.centroid ?? null),
    getUsgsEarthquakes(city?.centroid ?? null),
    getAmberAlerts(city?.state ?? null),
    getStateTraffic(city?.state ?? null, city?.centroid ?? null),
  ]);

  // Newest first. AMBER alerts are issued with severity "Extreme" by
  // default; we boost them to the top of the list (regardless of the
  // chronological sort) so they are not buried under routine weather.
  // fix(audit traffic-timestamp-sort-2): an empty / unparseable `effective`
  // (unknown timestamp) sorts to the BOTTOM rather than impersonating "now" and
  // outranking real recent alerts. +new Date("") is NaN, so coerce to -Infinity.
  const effMs = (a: OfficialAlert): number => {
    const t = +new Date(a.effective);
    return Number.isNaN(t) ? -Infinity : t;
  };
  const merged: OfficialAlert[] = [...nws, ...usgs, ...amber, ...traffic].sort(
    (a, b) => effMs(b) - effMs(a),
  );
  const amberFirst: OfficialAlert[] = merged.sort((a, b) => {
    const ax = a.source === "AMBER Alert" ? 0 : 1;
    const bx = b.source === "AMBER Alert" ? 0 : 1;
    return ax - bx;
  });
  const alerts = amberFirst;

  // Sources list reflects which adapters CONTRIBUTED, not the full
  // catalog — keeps the card honest about today's data shape. The
  // catalog itself stays visible in the disclaimer.
  const sourceLabels: string[] = [];
  if (amber.length > 0) sourceLabels.push("AMBER Alerts");
  if (nws.length > 0) sourceLabels.push("National Weather Service");
  if (usgs.length > 0) sourceLabels.push("USGS Earthquakes");
  if (traffic.length > 0 && roadAgency) sourceLabels.push(roadAgency);
  if (sourceLabels.length === 0) sourceLabels.push("National Weather Service", "USGS Earthquakes", "AMBER Alerts");

  return NextResponse.json({
    sources: sourceLabels,
    alerts,
    // fix(audit alerts-no-freshness-signal-7): expose when this aggregate was
    // assembled so the client can show "as of HH:MM" / flag a stale card. The
    // upstreams are each cached (NWS/AMBER/traffic ~5min), so a served response
    // can be a few minutes old; generatedAt makes that legible instead of silent.
    generatedAt: new Date().toISOString(),
    // null when the city's state has no free public traffic feed yet — the
    // panel shows an honest "not available" note instead of a blank card.
    roadAgency,
    disclaimer:
      "Aggregated from the National Weather Service (active weather alerts), " +
      "USGS Earthquakes (M2.5+ within 300km, past 72h), active AMBER Alerts " +
      "(Child Abduction Emergencies) for the user's state, and the state's " +
      "highway-patrol / DOT traffic feed (collisions, closures, and road " +
      "conditions near the city, where a public feed is available). " +
      "Independent of CommunitySafe community posts.",
  });
});
