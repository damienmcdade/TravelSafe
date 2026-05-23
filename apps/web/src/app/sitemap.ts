import type { MetadataRoute } from "next";

/// Sitemap covering the public surfaces. We expose the top-level tabs
/// and the three legal pages; we don't index the per-user surfaces
/// (login, moderation, onboarding) because they're either gated or
/// session-scoped. When per-neighborhood landing pages ship
/// (roadmap B1), this should also emit one URL per (city, area) pair
/// derived from each adapter's discover().
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://travel-safe-chi.vercel.app";
  const now = new Date();
  const tabs = ["/threats", "/map", "/watch", "/community", "/safety", "/safety-score", "/trends", "/route"];
  const legal = ["/privacy", "/terms", "/methodology"];
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
    ...legal.map((path) => ({
      url: `${base}${path}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.4,
    })),
  ];
}
