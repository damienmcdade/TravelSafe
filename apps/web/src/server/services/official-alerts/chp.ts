// California Highway Patrol traffic incidents via the CalTrans
// QuickMap public feed (quickmap.dot.ca.gov/data/chp-only.kml). The
// feed is a free, no-key, statewide KML refreshed every ~5 minutes —
// the same cadence we cache at. CHP is California-only, so this
// adapter returns [] for any non-CA city.
//
// Filtering posture is deliberately conservative. The raw statewide
// feed is dominated by routine entries — "Assist CT with Maintenance",
// "Traffic Hazard", construction, defective signals — that would flood
// a safety-awareness card and cut against the project's anti-fear
// ethos. We surface only the genuinely safety-relevant subset
// (collisions, road closures, vehicle/structure fires, injury hit-and-
// runs) within a metro-freeway radius of the city centroid, capped and
// sorted severe-first. Quiet is the common case, and a quiet card is
// the correct result.

import type { OfficialAlert } from "./nws";

const CACHE_TTL_MS = 5 * 60 * 1000;
const FEED_URL = "https://quickmap.dot.ca.gov/data/chp-only.kml";

// Single statewide fetch, cached once. Per-city radius filtering runs
// against the cached parse so switching CA cities never re-fetches the
// (large) KML within the TTL.
let cache: { fetchedAt: number; incidents: ParsedIncident[] } | null = null;

interface ParsedIncident {
  id: string;
  label: string;
  location: string;
  lat: number;
  lng: number;
  effective: string;
  severity: OfficialAlert["severity"];
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// The feed prints wall-clock Pacific time with no offset ("May 29 2026
// 9:40AM"). Parsing that naively on a UTC server (Railway / Vercel)
// would shift every timestamp 7-8 hours. Convert the LA wall-clock to a
// real UTC instant using the runtime's own tz database, which is
// DST-correct year-round without a date library.
function pacificWallClockToUtcIso(raw: string): string | null {
  // Normalize the double space and the missing space before AM/PM:
  // "May 29 2026  9:40AM" -> "May 29 2026 9:40 AM".
  const cleaned = raw.replace(/\s+/g, " ").replace(/(\d)(AM|PM)/i, "$1 $2").trim();
  const m = cleaned.match(/^([A-Za-z]+) (\d{1,2}) (\d{4}) (\d{1,2}):(\d{2}) (AM|PM)$/);
  if (!m) return null;
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const mo = months[m[1].slice(0, 3).toLowerCase()];
  if (mo == null) return null;
  const day = +m[2];
  const year = +m[3];
  let hour = +m[4] % 12;
  if (m[6].toUpperCase() === "PM") hour += 12;
  const minute = +m[5];

  // Standard tz-offset diff: interpret the components as if they were
  // UTC, ask the tz database what that instant looks like in LA, and
  // correct by the resulting offset.
  const naiveUtc = Date.UTC(year, mo, day, hour, minute);
  const offset = laOffsetMs(naiveUtc);
  return new Date(naiveUtc - offset).toISOString();
}

function laOffsetMs(utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  // formatToParts can emit "24" for midnight under hour12:false — clamp.
  const hour = get("hour") % 24;
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUtc - utcMs;
}

/// Classify a CHP incident label + KML style into our severity scale,
/// returning null for entries we deliberately do NOT surface (routine
/// maintenance, construction, hazards, advisories, signal faults).
function classify(label: string, styleId: string): OfficialAlert["severity"] | null {
  const l = label.toLowerCase();
  // Full road closures and fatalities are the most consequential.
  if (styleId === "full-closure" || /closure|fatal|20001/.test(l)) return "Severe";
  // Fires (vehicle or roadside structure) are time-critical safety events.
  if (/fire/.test(l)) return "Severe";
  // Collisions: injury / hit-and-run-with-injury read as Moderate; the
  // bare "No Inj" collision is Minor but still road-safety relevant.
  if (/collision|hit and run/.test(l)) {
    if (/no inj/.test(l)) return "Minor";
    return "Moderate";
  }
  if (/pedestrian/.test(l)) return "Moderate";
  // Everything else (Assist Maintenance, Traffic Hazard, Construction,
  // Animal, Defective Signals, Advisory, Weather, Traffic Break, etc.)
  // is intentionally dropped — not safety-card material.
  return null;
}

function parseFeed(kml: string): ParsedIncident[] {
  const out: ParsedIncident[] = [];
  // Placemarks are well-delimited; split rather than pull in an XML dep.
  const chunks = kml.split("<Placemark>").slice(1);
  for (const chunk of chunks) {
    const coord = chunk.match(/<coordinates>\s*(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (!coord) continue;
    const lng = Number(coord[1]);
    const lat = Number(coord[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const typeMatch = chunk.match(/<h2[^>]*>([^<]+)<\/h2>/);
    if (!typeMatch) continue;
    // "1125-Traffic Hazard" / "20001-Fatality" -> code, label. The label
    // itself can contain hyphens ("Trfc Collision-No Inj"), so split on
    // the FIRST hyphen following the leading incident code only.
    const codeLabel = typeMatch[1].trim().match(/^([0-9]+[A-Za-z]?)-(.+)$/);
    const label = codeLabel ? codeLabel[2].trim() : typeMatch[1].trim();

    const styleMatch = chunk.match(/<styleUrl>#([^<]+)<\/styleUrl>/);
    const styleId = styleMatch ? styleMatch[1].trim() : "chp";

    const severity = classify(label, styleId);
    if (!severity) continue;

    const idMatch = chunk.match(/CHP Incident\s+([A-Za-z0-9]+)/);
    const id = idMatch ? idMatch[1] : `${lat.toFixed(4)},${lng.toFixed(4)}`;

    // First iw-text paragraph holds "DATE TIME <br> LOCATION".
    const timeLoc = chunk.match(/<p class="iw-text">([^<]+?)<br\s*\/?>\s*([^<]*)<\/p>/);
    const rawTime = timeLoc ? timeLoc[1].trim() : "";
    const location = timeLoc ? timeLoc[2].replace(/\s+/g, " ").trim() : "";
    const effective = pacificWallClockToUtcIso(rawTime) ?? new Date().toISOString();

    out.push({ id, label, location, lat, lng, effective, severity });
  }
  return out;
}

/// Pull active CHP incidents near the given centroid. CA-only — returns
/// [] immediately for any other state so the aggregator pays no cost for
/// the 28 non-CA cities. Degrades to [] (never throws) on any upstream
/// failure, matching the other adapters so one dead feed can't blank the
/// whole alerts card.
export async function getChpIncidents(
  state: string | null,
  centroid: { lat: number; lng: number } | null,
  radiusKm: number = 25,
): Promise<OfficialAlert[]> {
  if (state !== "CA" || !centroid) return [];
  const now = Date.now();
  try {
    if (!cache || now - cache.fetchedAt >= CACHE_TTL_MS) {
      const res = await fetch(FEED_URL, {
        headers: {
          Accept: "application/vnd.google-earth.kml+xml, application/xml, text/xml",
          "User-Agent": "TravelSafe/0.1 (https://github.com/damienmcdade/TravelSafe)",
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return projectNear(cache?.incidents ?? [], centroid, radiusKm);
      const kml = await res.text();
      cache = { fetchedAt: now, incidents: parseFeed(kml) };
    }
    return projectNear(cache.incidents, centroid, radiusKm);
  } catch {
    return projectNear(cache?.incidents ?? [], centroid, radiusKm);
  }
}

const SEVERITY_RANK: Record<OfficialAlert["severity"], number> = {
  Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4,
};

/// Filter cached statewide incidents to those near the city, then shape
/// them into OfficialAlerts (severe-first, nearest-first, capped at 6 so
/// a busy freeway day can't dominate the card).
function projectNear(
  incidents: ParsedIncident[],
  centroid: { lat: number; lng: number },
  radiusKm: number,
): OfficialAlert[] {
  return incidents
    .map((i) => ({ i, km: haversineKm({ lat: i.lat, lng: i.lng }, centroid) }))
    .filter(({ km }) => km <= radiusKm)
    .sort((a, b) => SEVERITY_RANK[a.i.severity] - SEVERITY_RANK[b.i.severity] || a.km - b.km)
    .slice(0, 6)
    .map(({ i }) => ({
      id: `chp:${i.id}`,
      source: "CHP Traffic",
      category: "Traffic",
      severity: i.severity,
      headline: i.location ? `${i.label} — ${i.location}` : i.label,
      description:
        `California Highway Patrol incident${i.location ? ` near ${i.location}` : ""}. ` +
        `Reported on the CHP computer-aided-dispatch feed; details may change as units respond.`,
      effective: i.effective,
      expires: null,
      url: "https://quickmap.dot.ca.gov/",
    }));
}
