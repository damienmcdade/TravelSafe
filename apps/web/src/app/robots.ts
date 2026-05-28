import type { MetadataRoute } from "next";

/// robots.txt directives — allow general crawling but block the
/// authentication, moderation, and per-user endpoints so search
/// engines don't index session-scoped pages.
///
/// v96 — opt out of per-request rendering. The rules above are
/// completely static (no env or request-derived branching that
/// changes between deploys), so a year-long revalidate window lets
/// the CDN serve the same response for the full deploy without the
/// route handler running again. A deploy busts the cache anyway.
export const revalidate = 31536000;

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://communitysafe.app";
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/threats", "/map", "/watch", "/community", "/safety", "/safety-score", "/trends", "/route", "/privacy", "/terms", "/methodology", "/coverage", "/cities"],
        disallow: ["/api/", "/login", "/register", "/moderation", "/onboarding/", "/share/", "/contacts/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
