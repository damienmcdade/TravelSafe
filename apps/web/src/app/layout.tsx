import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CityBackdrop } from "@/components/CityBackdrop";
import { SessionBootstrap } from "@/components/SessionBootstrap";

// Title template — each page sets its own `title` (e.g. "Safety Score")
// and Next slots it into "{title} · TravelSafe" automatically. Default is
// the fallback for pages that don't set one explicitly.
// metadataBase resolves relative URLs (alternates.canonical, og.images) to
// absolute. NEXT_PUBLIC_SITE_URL is the canonical override; falls through
// to the production alias so local builds still emit valid links.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://travel-safe-chi.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "TravelSafe",
    template: "%s · TravelSafe",
  },
  description:
    "Neighborhood-level safety awareness across 30 US cities. Drawn from " +
    "official police data sources and the FBI Crime in the Nation 2023 " +
    "national average. Not surveillance; not a substitute for emergency services.",
  manifest: "/manifest.json",
  // openGraph defaults inherited by every page. Per-page metadata can
  // override `title`, `description`, `images`, etc. and Next merges with
  // these defaults. Without these, social previews for the homepage and
  // every tab without its own opengraph-image.tsx were barren.
  openGraph: {
    type: "website",
    siteName: "TravelSafe",
    locale: "en_US",
    // Next auto-detects opengraph-image.tsx at every route segment, so
    // we DON'T list a static images array here — letting Next emit the
    // route-specific image (root or per-city) preserves the per-URL
    // tailored cards we shipped in d6850f2 / 4e2aec8.
  },
  // Twitter card defaults — `summary_large_image` tells X scrapers to
  // render the full 1200×630 OG image instead of the small square
  // thumbnail fallback. Without this every shared TravelSafe URL on X
  // showed a tiny preview tile. Next auto-mirrors openGraph.images into
  // twitter.images when not explicitly set, so the per-URL tailored
  // cards flow through automatically.
  twitter: {
    card: "summary_large_image",
    title: "TravelSafe",
    description:
      "Neighborhood-level safety awareness across 30 US cities. Drawn from official police open-data feeds.",
  },
  // Apple-specific PWA hints so iOS gives the install a proper standalone
  // chrome (no Safari URL bar) and the right title under the home-screen
  // icon. Without these iOS falls back to a generic web-clip experience.
  appleWebApp: {
    capable: true,
    title: "TravelSafe",
    statusBarStyle: "default",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* CityBackdrop sits at z:0 (its own stacking context via position:fixed).
            All page content is wrapped in `relative z-10` so it paints above the
            backdrop instead of underneath. The body is transparent so the
            backdrop is the actual paint at the bottom of the viewport. */}
        <CityBackdrop />
        <SessionBootstrap />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
