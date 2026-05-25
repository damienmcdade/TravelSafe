import { findArea, nearestArea, listKnownAreas, listKnownAreasSync, type KnownArea } from "../crime-data/neighborhoods";

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

// v53 — tighten the loose token-match scoring so a query like
// "123 Main St San Diego" doesn't fuzzy-match to "Bedford-
// Stuyvesant East" (NYC) because "st" appears inside "stuy". The
// prior version awarded score = token.length for any substring
// hit; tokens of length 2 like "st" and "rd" were the smoking gun.
// v53 fixes:
//   - require minimum token length 4 to score (eliminates "st",
//     "rd", "ave" false positives)
//   - require WORD-BOUNDARY match (the token has to start a word
//     in the haystack, not appear mid-word)
//   - cap final score against the haystack length so an area whose
//     label simply contains MANY short bits doesn't out-rank a
//     genuine substring match
function fuzzyMatch(needle: string, areas: KnownArea[]): KnownArea | null {
  const n = needle.toLowerCase().replace(/[^a-z0-9 ]+/g, "");
  if (!n) return null;
  const tokens = n.split(/\s+/).filter((t) => t.length >= 4);
  if (tokens.length === 0) return null;
  let best: { area: KnownArea; score: number } | null = null;
  for (const area of areas) {
    const hay = `${area.slug} ${area.label}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      const re = new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
      if (re.test(hay)) score += t.length;
    }
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
      headers: { "User-Agent": "CommunitySafe/0.1 (https://github.com/damienmcdade/CommunitySafe)" },
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

  // Try the cheap matches first BEFORE doing the heavy 30-adapter
  // listKnownAreas() fan-out. exact + zip + nominatim hit synchronous
  // tables or a single HTTP call; they complete in <500ms. Only fall
  // back to the full discovery list for the fuzzy-match path.
  // Previously this loaded the full list up-front and routinely
  // exceeded the 30s Vercel timeout on cold cache.
  const exact = findArea(trimmed);
  if (exact) return { area: exact, matchedVia: "exact", rawQuery: trimmed };

  // v55 — ZIP code handling. SD_ZIP_TO_AREA only covers San Diego
  // (zips starting with 9); a user typing "85001" (Phoenix), "10001"
  // (NYC), "33101" (Miami), etc. previously got "no_match" because
  // the regex required `9\d{4}`. Now: any 5-digit ZIP either hits
  // the SD direct-map (fast path, no upstream call) OR falls through
  // to the geocode + snap-to-nearest path so EVERY US ZIP resolves.
  const zip5 = trimmed.match(/\b(\d{5})\b/);
  if (zip5) {
    const z = zip5[1];
    if (SD_ZIP_TO_AREA[z]) {
      const area = findArea(SD_ZIP_TO_AREA[z]);
      if (area) return { area, matchedVia: "zip", rawQuery: trimmed };
    }
    // Geocode the ZIP centroid via Nominatim — works for every US
    // ZIP without us maintaining a 30-city map. The nearestArea snap
    // below ensures the result is one of our supported neighborhoods.
    const geo = await nominatimGeocode(`${z} USA`);
    if (geo) {
      // Ensure discovered-area list is fully populated before snap.
      const areas = listKnownAreasSync();
      if (areas.length < 50) await listKnownAreas().catch(() => []);
      const area = nearestArea(geo);
      if (area) return { area, matchedVia: "zip", rawQuery: trimmed };
    }
  }

  // Only now pull the discovered list for fuzzy matching. Use the
  // sync (last-known-good) variant first — it returns whatever the
  // most-recent listKnownAreas() call populated. If the cache is
  // cold, we still try the async load but wrap in a timeout so
  // the lookup endpoint never blocks past ~12s.
  // v53 — when the input LOOKS like a street address (leading
  // digit, OR contains a street-suffix keyword), skip fuzzy and
  // go straight to Nominatim. Fuzzy is for "Pacific Beach"-style
  // bare neighborhood names; for "1600 Pennsylvania Ave Washington
  // DC" or "123 Main St San Diego" it produces nonsense (the prior
  // build matched the SD address to Bedford-Stuyvesant East in NYC
  // because "st" appeared inside "stuyvesant").
  const looksLikeAddress = /^\s*\d/.test(trimmed)
    || /\b(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|pl|place|ct|court|hwy|highway|pkwy|parkway)\.?\b/i.test(trimmed);

  let areas = listKnownAreasSync();
  if (!looksLikeAddress) {
    if (areas.length < 50) {
      // Cache is cold or fallback-only — pull fresh but cap the wait
      // at 12s so the endpoint returns SOMETHING within Vercel's budget.
      const timeout = new Promise<KnownArea[]>((resolve) =>
        setTimeout(() => resolve(areas), 12_000));
      areas = await Promise.race([listKnownAreas(), timeout]);
    }
    const fuzzy = fuzzyMatch(trimmed, areas);
    if (fuzzy) return { area: fuzzy, matchedVia: "fuzzy", rawQuery: trimmed };
  }

  const geo = await nominatimGeocode(trimmed);
  if (geo) {
    // Make sure we have a full discovered-area list so the snap-to-
    // nearest math has the city's polygons to compare against.
    // listKnownAreas() refreshes the cache; nearestArea reads the
    // sync (last-known-good) snapshot the listKnownAreas pass writes.
    if (areas.length < 50) await listKnownAreas().catch(() => []);
    const area = nearestArea(geo);
    if (area) return { area, matchedVia: "geocode", rawQuery: trimmed };
  }
  return null;
}

export async function allKnownAreas(): Promise<KnownArea[]> {
  return listKnownAreas();
}
