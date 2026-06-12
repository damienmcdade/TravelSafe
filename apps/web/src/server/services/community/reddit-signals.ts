import "server-only";
import { cityForArea } from "../crime-data/cities";

// Per-neighborhood community signals sourced from Reddit's public JSON.
//
// Reddit's /r/{sub}/search.json works without authentication for browse-style
// queries and is the most accessible public source of plain-language
// community chatter about a neighborhood. We restrict to each city's main
// subreddit (so we don't pick up a Pittsburgh post when someone asks about
// "Mission Bay"), require the neighborhood name to appear in the title or
// body, sort by recent, and cap at a small handful of cards.
//
// Hard guardrails:
// - We do NOT pull comments (just thread titles + a short excerpt) — keeps
//   the risk of repeating personal attacks / doxxing / harassment lower.
// - The user always sees a "via Reddit" attribution and clicks through to
//   the original thread; we never present this as CommunitySafe's own content.
// - NSFW / over-18 posts are filtered out by Reddit's own flag.

// Well-known, established public city subreddits. A wrong/old name simply yields
// an empty Community Signals card (graceful), never an error. Covers all 45.
const CITY_SUBREDDITS: Record<string, string> = {
  "san-diego":     "sandiego",
  "los-angeles":   "LosAngeles",
  "san-francisco": "sanfrancisco",
  "oakland":       "oakland",
  "sacramento":    "Sacramento",
  "long-beach":    "longbeach",
  "chicago":       "chicago",
  "seattle":       "Seattle",
  "new-york":      "nyc",
  "colorado-springs": "ColoradoSprings",
  "denver":        "Denver",
  "boise":         "Boise",
  "detroit":       "Detroit",
  "washington-dc": "washingtondc",
  "philadelphia":  "philadelphia",
  "pittsburgh":    "pittsburgh",
  "boston":        "boston",
  "cambridge":     "CambridgeMA",
  "buffalo":       "Buffalo",
  "cincinnati":    "cincinnati",
  "cleveland":     "Cleveland",
  "new-orleans":   "NewOrleans",
  "baton-rouge":   "BatonRouge",
  "dallas":        "Dallas",
  "fort-worth":    "FortWorth",
  "houston":       "houston",
  "charlotte":     "Charlotte",
  "baltimore":     "baltimore",
  "montgomery-county": "moco",
  "prince-georges-county": "PrinceGeorgesCounty",
  "minneapolis":   "minnesota",
  "saint-paul":    "StPaul",
  "milwaukee":     "milwaukee",
  "kansas-city":   "kansascity",
  "indianapolis":  "indianapolis",
  "las-vegas":     "vegas",
  "atlanta":       "Atlanta",
  "norfolk":       "norfolk",
  "virginia-beach": "VirginiaBeach",
  "nashville":     "nashville",
  "phoenix":       "phoenix",
  "jacksonville":  "Jacksonville",
  "tampa":         "tampa",
  "gainesville":   "gainesville",
  "honolulu":      "Honolulu",
};

export interface CommunitySignal {
  id: string;
  title: string;
  excerpt: string;
  url: string;
  subreddit: string;
  postedAt: string;
  score: number;
  comments: number;
}

interface CacheEntry { fetchedAt: number; signals: CommunitySignal[] }
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000;       // 15-min cache per area
const SIGNAL_LIMIT = 8;

interface RedditChild {
  data?: {
    id?: string;
    title?: string;
    selftext?: string;
    permalink?: string;
    subreddit?: string;
    created_utc?: number;
    score?: number;
    num_comments?: number;
    over_18?: boolean;
    stickied?: boolean;
  };
}

interface RedditResp { data?: { children?: RedditChild[] } }

/// Strip a city-prefix slug ("la-hollywood" → "hollywood") and humanize it
/// ("la-west-la" → "west la"). The result is what we search Reddit for.
function neighborhoodQuery(areaSlug: string, cityLabel: string): string {
  // Strip the city routing prefix to recover the neighborhood name. Covers every
  // city's prefix (san-diego is unprefixed, so its bare name-derived slugs pass
  // through untouched). Mirrors AREA_SLUG_PREFIX in crime-data/cities.ts.
  const prefix = /^(la|sf|chi|sea|ny|cosp|det|dc|bos|phl|oak|cin|nola|br|cam|dal|clt|balt|mpls|cle|mke|lv|bzi|buf|nor|kc|sp|pgh|fw|den|sac|atl|indy|hnl|lb|phx|jax|vb|gnv|tpa|bna|hou|moco|pg)-/;
  const stripped = areaSlug.replace(prefix, "").replace(/-/g, " ").trim();
  // For city defaults like "san-diego" / "chicago" the stripped value matches
  // the city label — just search the city if no neighborhood was selected.
  if (!stripped || stripped.toLowerCase() === cityLabel.toLowerCase()) return cityLabel;
  return stripped;
}

export async function getCommunitySignals(areaSlug: string): Promise<{ source: string; signals: CommunitySignal[] }> {
  const city = cityForArea(areaSlug);
  const sub = CITY_SUBREDDITS[city.slug];
  if (!sub) return { source: "Reddit", signals: [] };

  const q = neighborhoodQuery(areaSlug, city.label);
  const cacheKey = `${sub}:${q.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { source: `Reddit · r/${sub}`, signals: cached.signals };
  }

  // Reddit requires a non-generic UA and rate-limits aggressively.
  const url = new URL(`https://www.reddit.com/r/${sub}/search.json`);
  url.searchParams.set("q", q);
  url.searchParams.set("restrict_sr", "1");
  url.searchParams.set("sort", "new");
  url.searchParams.set("limit", "20");

  let signals: CommunitySignal[] = [];
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        // Reddit gets pickier about UAs over time; use a browser-shaped one.
        "User-Agent": "Mozilla/5.0 (compatible; CommunitySafe/0.1; +https://github.com/damienmcdade/TravelSafe)",
      },
      // fix(audit resilience): bound the request. Reddit blocks Vercel IPs, and
      // a blackholed connection won't fast-fail — without a signal a hung
      // upstream blocks the server render to the function ceiling.
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`Reddit ${res.status}`);
    const body = (await res.json()) as RedditResp;
    const children = body.data?.children ?? [];
    signals = children
      .map((c) => c.data)
      .filter((d): d is NonNullable<typeof d> => Boolean(d?.title && d?.permalink))
      .filter((d) => !d.over_18 && !d.stickied)
      .slice(0, SIGNAL_LIMIT)
      .map((d) => ({
        id: `reddit-${d.id}`,
        title: d.title!.trim(),
        excerpt: (d.selftext ?? "").replace(/\s+/g, " ").trim().slice(0, 280),
        url: `https://www.reddit.com${d.permalink}`,
        subreddit: d.subreddit ?? sub,
        postedAt: new Date((d.created_utc ?? 0) * 1000).toISOString(),
        score: d.score ?? 0,
        comments: d.num_comments ?? 0,
      }));
  } catch (err) {
    console.warn("[community-signals] reddit fetch failed:", (err as Error).message);
  }

  // Reddit blocks Vercel's IP range (same pattern we saw with data.boston.gov)
  // — falls through with 0 signals. Fall back to Google News headlines for
  // the same neighborhood query so users always see something community-
  // shaped. The news fallback is already proven reliable from Vercel.
  if (signals.length === 0) {
    try {
      const newsUrl = new URL("https://news.google.com/rss/search");
      newsUrl.searchParams.set("q", `${q} ${city.label} when:30d`);
      newsUrl.searchParams.set("hl", "en-US");
      newsUrl.searchParams.set("gl", "US");
      newsUrl.searchParams.set("ceid", "US:en");
      const res = await fetch(newsUrl, { headers: { Accept: "application/rss+xml", "User-Agent": "CommunitySafe/0.1" }, signal: AbortSignal.timeout(8_000) });
      if (res.ok) {
        const xml = await res.text();
        const items = xml.split(/<item>/i).slice(1, SIGNAL_LIMIT + 1);
        for (const raw of items) {
          const close = raw.indexOf("</item>");
          const block = close >= 0 ? raw.slice(0, close) : raw;
          const get = (tag: string) => block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"))?.[1] ?? "";
          const title = get("title").replace(/<[^>]+>/g, "").trim();
          const link = get("link").replace(/<[^>]+>/g, "").trim();
          const pub = get("pubDate");
          const source = get("source") || (link ? new URL(link).hostname.replace(/^www\./, "") : "Google News");
          if (!title || !link) continue;
          signals.push({
            id: `news-${signals.length}`,
            title,
            excerpt: "",
            url: link,
            subreddit: source,
            postedAt: pub ? new Date(pub).toISOString() : new Date().toISOString(),
            score: 0,
            comments: 0,
          });
        }
      }
    } catch (err) {
      console.warn("[community-signals] news fallback failed:", (err as Error).message);
    }
    const label = signals.length > 0 ? `Google News · ${city.label} · ${q}` : `Reddit · r/${sub}`;
    cache.set(cacheKey, { fetchedAt: Date.now(), signals });
    return { source: label, signals };
  }

  cache.set(cacheKey, { fetchedAt: Date.now(), signals });
  return { source: `Reddit · r/${sub}`, signals };
}
