import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

// v55 — viewport configuration for the Capacitor iOS shell + mobile
// browsers. viewportFit "cover" lets the WebView extend behind the
// notch / home indicator so safe-area-inset-* CSS env() values are
// non-zero (otherwise iOS clamps everything inside the safe rect and
// the app looks letterboxed). themeColor tints the iOS status bar.
// minimum/maximum-scale=1 prevents accidental two-finger zoom on the
// map and other interactive surfaces.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF7F2" },
    { media: "(prefers-color-scheme: dark)",  color: "#0F172A" },
  ],
};
import Script from "next/script";
import { CityBackdrop } from "@/components/CityBackdrop";
import { SessionBootstrap } from "@/components/SessionBootstrap";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/use-theme";

// Google AdSense publisher ID. Default is the CommunitySafe account
// (ca-pub-8731629548430880); env var override lets staging /
// preview deploys point at a different account if needed. When the
// resolved value is the empty string AdSense is disabled — no
// script load, no meta tag.
const ADSENSE_CLIENT_ID = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID ?? "ca-pub-8731629548430880";

// Title template — each page sets its own `title` (e.g. "Safety Score")
// and Next slots it into "{title} · CommunitySafe" automatically. Default is
// the fallback for pages that don't set one explicitly.
// metadataBase resolves relative URLs (alternates.canonical, og.images) to
// absolute. NEXT_PUBLIC_SITE_URL is the canonical override; falls through
// to the production alias so local builds still emit valid links.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://travel-safe-chi.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "CommunitySafe",
    template: "%s · CommunitySafe",
  },
  description:
    "Neighborhood-level safety awareness across 30 US cities. Drawn from " +
    "official police data sources and the FBI Crime Data Explorer 2025 " +
    "national average. Not surveillance; not a substitute for emergency services.",
  manifest: "/manifest.json",
  // openGraph defaults inherited by every page. Per-page metadata can
  // override `title`, `description`, `images`, etc. and Next merges with
  // these defaults. Without these, social previews for the homepage and
  // every tab without its own opengraph-image.tsx were barren.
  openGraph: {
    type: "website",
    siteName: "CommunitySafe",
    locale: "en_US",
    // Next auto-detects opengraph-image.tsx at every route segment, so
    // we DON'T list a static images array here — letting Next emit the
    // route-specific image (root or per-city) preserves the per-URL
    // tailored cards we shipped in d6850f2 / 4e2aec8.
  },
  // Twitter card defaults — `summary_large_image` tells X scrapers to
  // render the full 1200×630 OG image instead of the small square
  // thumbnail fallback. Without this every shared CommunitySafe URL on X
  // showed a tiny preview tile. Next auto-mirrors openGraph.images into
  // twitter.images when not explicitly set, so the per-URL tailored
  // cards flow through automatically.
  twitter: {
    card: "summary_large_image",
    title: "CommunitySafe",
    description:
      "Neighborhood-level safety awareness across 30 US cities. Drawn from official police open-data feeds.",
  },
  // Apple-specific PWA hints so iOS gives the install a proper standalone
  // chrome (no Safari URL bar) and the right title under the home-screen
  // icon. Without these iOS falls back to a generic web-clip experience.
  appleWebApp: {
    capable: true,
    title: "CommunitySafe",
    statusBarStyle: "default",
  },
  // AdSense account-verification meta tag. Google reads
  // <meta name="google-adsense-account" content="ca-pub-..."> at the
  // domain root to confirm site ownership. Only emitted when the env
  // var is configured.
  other: ADSENSE_CLIENT_ID
    ? { "google-adsense-account": ADSENSE_CLIENT_ID }
    : undefined,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Pre-paint theme bootstrap — sets the dark class on <html>
            from localStorage BEFORE React hydrates so users on dark
            theme don't see a light-mode flash. suppressHydrationWarning
            on <html> stops React from complaining about the class
            mismatch this script intentionally introduces. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        {/* Google AdSense auto-ads loader. Conditional on the env var
            being set so non-production deploys don't request ads.
            strategy="afterInteractive" loads after the page is
            interactive — keeps Largest Contentful Paint clean. */}
        {ADSENSE_CLIENT_ID && (
          <Script
            id="adsense-auto-ads"
            async
            strategy="afterInteractive"
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}`}
            crossOrigin="anonymous"
          />
        )}
      </head>
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
