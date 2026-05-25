import type { MetadataRoute } from "next";
import { CITIES } from "@/server/services/crime-data/cities";
import type { KnownArea } from "@travelsafe/crime-data";

/// Sitemap covering every public surface. Emits:
///   - The homepage + every live app tab
///   - Legal pages (privacy / terms / methodology)
///   - /cities directory + one URL per supported city
///   - One URL per (city, neighborhood) for the programmatic SEO pages
///
/// Per-neighborhood URLs are streamed by awaiting every city's
/// discover() in PARALLEL with a per-city soft-fail. A single broken
/// adapter shouldn't tank the entire sitemap — we just omit that city's
/// neighborhoods until the next refresh. Total cost on cold cache is
/// dominated by the slowest adapter (typically Detroit at ~10s); the
/// adapter cache means subsequent calls within the cache window are
/// instant. Next caches the sitemap response with the
/// `revalidate` window so crawlers don't trigger a refetch on every
/// hit.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://travel-safe-chi.vercel.app";
  const now = new Date();
  const tabs = ["/threats", "/map", "/watch", "/community", "/safety", "/safety-score", "/trends", "/route", "/coverage", "/cities"];
  const legal = ["/privacy", "/terms", "/methodology"];

  // Per-city discover() in parallel, soft-fail per city so one broken
  // adapter doesn't drop every other city's neighborhood URLs.
  //
  // v57 — added a per-city 15s timeout. Vercel build was hitting the
  // 60s function ceiling on /sitemap.xml because slow adapters
  // (Detroit's 30k row fetch on a cold Railway cache) pinned the
  // whole Promise.all. With a timeout, the slowest adapter contributes
  // 0 neighborhood URLs for that build; the next hourly revalidation
  // picks them up once the adapter cache warms. The sitemap still ships
  // the homepage + every supported city's index page so SEO coverage
  // is preserved.
  const CITY_DISCOVER_TIMEOUT_MS = 15_000;
  const perCity = await Promise.all(
    CITIES.map(async (city) => {
      const areas: KnownArea[] = await Promise.race<KnownArea[]>([
        city.discover().catch(() => [] as KnownArea[]),
        new Promise<KnownArea[]>((resolve) => setTimeout(() => resolve([] as KnownArea[]), CITY_DISCOVER_TIMEOUT_MS)),
      ]);
      return { city, areas };
    }),
  );

  const neighborhoodUrls: MetadataRoute.Sitemap = perCity.flatMap(({ city, areas }) =>
    areas.map((a) => ({
      url: `${base}/cities/${city.slug}/${a.slug}`,
      lastModified: now,
      // Per-neighborhood pages revalidate hourly with the underlying
      // adapter cache; "daily" is a conservative crawl signal.
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
  );

  return [
    {
      url: base,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1.0,
    },
    ...tabs.map((path) => ({
      url: `${base}${path}`,
      lastModified: now,
      changeFrequency: "hourly" as const,
      priority: 0.8,
    })),
    ...CITIES.map((c) => ({
      url: `${base}/cities/${c.slug}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...neighborhoodUrls,
    ...legal.map((path) => ({
      url: `${base}${path}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.4,
    })),
  ];
}
