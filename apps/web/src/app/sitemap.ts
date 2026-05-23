import type { MetadataRoute } from "next";
import { CITIES } from "@/server/services/crime-data/cities";

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
  const perCity = await Promise.all(
    CITIES.map(async (city) => {
      const areas = await city.discover().catch(() => []);
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
