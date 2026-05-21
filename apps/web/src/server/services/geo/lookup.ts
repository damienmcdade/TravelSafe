import { findArea, nearestArea, listKnownAreas, type KnownArea } from "../crime-data/neighborhoods";

const SD_ZIP_TO_AREA: Record<string, string> = {
  "92101": "downtown-sd",
  "92103": "hillcrest",
  "92104": "north-park",
  "92108": "mission-valley",
  "92109": "pacific-beach",
  "92037": "la-jolla",
  "92126": "mira-mesa",
  "92121": "mira-mesa",
  "92123": "mission-valley",
};

export interface LookupResult {
  area: KnownArea;
  matchedVia: "exact" | "zip" | "fuzzy" | "geocode";
  rawQuery: string;
}

function fuzzyMatch(needle: string, areas: KnownArea[]): KnownArea | null {
  const n = needle.toLowerCase().replace(/[^a-z0-9 ]+/g, "");
  if (!n) return null;
  const tokens = n.split(/\s+/).filter(Boolean);
  let best: { area: KnownArea; score: number } | null = null;
  for (const area of areas) {
    const hay = `${area.slug} ${area.label}`.toLowerCase();
    let score = 0;
    for (const t of tokens) if (hay.includes(t)) score += t.length;
    if (score > 0 && (!best || score > best.score)) best = { area, score };
  }
  return best?.area ?? null;
}

async function nominatimGeocode(query: string): Promise<{ lat: number; lng: number } | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", `${query}, San Diego, California`);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("viewbox", "-117.6,33.5,-116.0,32.5");
  url.searchParams.set("bounded", "1");
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "TravelSafe/0.1 (https://github.com/damienmcdade/TravelSafe)" },
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!arr.length) return null;
    return { lat: Number(arr[0].lat), lng: Number(arr[0].lon) };
  } catch {
    return null;
  }
}

export async function lookupLocation(q: string): Promise<LookupResult | null> {
  const trimmed = q.trim();
  if (!trimmed) return null;

  // Always pull the discovered list so we can match against the full ~100+
  // SDPD-known neighborhoods, not just the small hardcoded fallback.
  const areas = await listKnownAreas();

  const exact = findArea(trimmed);
  if (exact) return { area: exact, matchedVia: "exact", rawQuery: trimmed };

  const zipMatch = trimmed.match(/\b(9\d{4})\b/);
  if (zipMatch && SD_ZIP_TO_AREA[zipMatch[1]]) {
    const area = findArea(SD_ZIP_TO_AREA[zipMatch[1]]);
    if (area) return { area, matchedVia: "zip", rawQuery: trimmed };
  }

  const fuzzy = fuzzyMatch(trimmed, areas);
  if (fuzzy) return { area: fuzzy, matchedVia: "fuzzy", rawQuery: trimmed };

  const geo = await nominatimGeocode(trimmed);
  if (geo) {
    const area = nearestArea(geo);
    if (area) return { area, matchedVia: "geocode", rawQuery: trimmed };
  }
  return null;
}

export async function allKnownAreas(): Promise<KnownArea[]> {
  return listKnownAreas();
}
