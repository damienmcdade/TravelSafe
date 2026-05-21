import "server-only";

// Pulls San Diego–scoped safety news from Google News' public RSS feed.
// Google News allows light RSS use without an API key. Cache 30 min to be
// polite + keep latency low. Results are returned as plain JSON the UI
// renders as link-out cards — we never re-host article bodies.

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { fetchedAt: number; query: string; items: NewsItem[] } | null = null;

export interface NewsItem {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  snippet?: string;
}

const DEFAULT_QUERY = "San Diego crime OR safety OR police";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "").trim());
}

/// Very small, dependency-free RSS parser tuned for Google News output.
function parseGoogleNewsRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemBlocks = xml.split(/<item>/i).slice(1);
  for (const raw of itemBlocks) {
    const close = raw.indexOf("</item>");
    const block = close >= 0 ? raw.slice(0, close) : raw;
    const get = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
      return m ? stripHtml(m[1]) : "";
    };
    const title = get("title");
    const link = get("link");
    const pubDate = get("pubDate");
    const description = get("description");
    const source = get("source") || (link ? new URL(link).hostname.replace(/^www\./, "") : "Unknown");
    if (!title || !link) continue;
    items.push({
      title,
      link,
      source,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      snippet: description.slice(0, 240),
    });
    if (items.length >= 12) break;
  }
  return items;
}

export async function getNews(query: string = DEFAULT_QUERY): Promise<NewsItem[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS && cache.query === query) return cache.items;
  try {
    const url = new URL("https://news.google.com/rss/search");
    url.searchParams.set("q", `${query} when:7d`);
    url.searchParams.set("hl", "en-US");
    url.searchParams.set("gl", "US");
    url.searchParams.set("ceid", "US:en");
    const res = await fetch(url, {
      headers: {
        "User-Agent": "TravelSafe/0.1 (https://github.com/damienmcdade/TravelSafe)",
        Accept: "application/rss+xml, application/xml, text/xml",
      },
    });
    if (!res.ok) return cache?.items ?? [];
    const xml = await res.text();
    const items = parseGoogleNewsRss(xml);
    cache = { fetchedAt: now, query, items };
    return items;
  } catch {
    return cache?.items ?? [];
  }
}
