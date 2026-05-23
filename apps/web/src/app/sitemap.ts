import type { MetadataRoute } from "next";
import { CITIES } from "@/server/services/crime-data/cities";

/// Sitemap covering the public surfaces. Emits:
///   - The homepage + every live app tab
///   - Legal pages (privacy / terms / methodology)
///   - /cities directory + one URL per supported city (/cities/<slug>)
///
/// We deliberately do NOT emit /cities/<city>/<neighborhood> URLs here
/// because that requires await-ing every adapter's discover() at sitemap-
/// generation time (30 cities × adapter latency = slow). Search engines
/// will discover the per-neighborhood pages by crawling the city-level
/// pages, which list every neighborhood. If we hit a coverage problem
/// (engines not finding per-area pages), we can switch to streaming them
/// here via async sitemap generation.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://travel-safe-chi.vercel.app";
  const now = new Date();
  const tabs = ["/threats", "/map", "/watch", "/community", "/safety", "/safety-score", "/trends", "/route", "/coverage", "/cities"];
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
    ...CITIES.map((c) => ({
      url: `${base}/cities/${c.slug}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...legal.map((path) => ({
      url: `${base}${path}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.4,
    })),
  ];
}
