import type { MetadataRoute } from "next";

/// robots.txt directives — allow general crawling but block the
/// authentication, moderation, and per-user endpoints so search
/// engines don't index session-scoped pages.
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://travel-safe-chi.vercel.app";
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/threats", "/map", "/watch", "/community", "/safety", "/safety-score", "/trends", "/route", "/privacy", "/terms", "/methodology"],
        disallow: ["/api/", "/login", "/register", "/moderation", "/onboarding/", "/share/", "/contacts/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
