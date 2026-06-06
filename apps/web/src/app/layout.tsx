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
import { ConsentedAdSense } from "@/components/ConsentedAdSense";
// v96 — CityBackdrop is ~169 kB of city photo URLs that was eagerly
// imported into the root layout's First Load JS on every route.
// The Lazy wrapper is a client-only dynamic import so the chunk
// only ships when a page actually renders it.
import { CityBackdropLazy as CityBackdrop } from "@/components/CityBackdropLazy";
import { SessionBootstrap } from "@/components/SessionBootstrap";
import { CookieConsentBanner } from "@/components/CookieConsentBanner";
import { AgeGate } from "@/components/AgeGate";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/use-theme";
import { FBI_DATA_LABEL } from "@/lib/data-vintage";

// v92 — removed the hardcoded "ca-pub-8731629548430880" default. Pre-v92
// AdSense loaded on every page regardless of operator intent, contradicting
// the privacy policy ("no third-party advertising"). Now opt-in only via
// the env var. Any deploy that sets NEXT_PUBLIC_ADSENSE_CLIENT_ID must
// pair it with an active cookie-consent banner because AdSense profiling
// cookies are a "sale/share" under CCPA.
const ADSENSE_CLIENT_ID = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID;

// Title template — each page sets its own `title` (e.g. "Safety Score")
// and Next slots it into "{title} · CommunitySafe" automatically. Default is
// the fallback for pages that don't set one explicitly.
// metadataBase resolves relative URLs (alternates.canonical, og.images) to
// absolute. NEXT_PUBLIC_SITE_URL is the canonical override; falls through
// to the production alias so local builds still emit valid links.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://communitysafe.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "CommunitySafe",
    template: "%s · CommunitySafe",
  },
  description:
    "Neighborhood-level safety awareness across 44 US cities. Drawn from " +
    `official police data sources and the ${FBI_DATA_LABEL} ` +
    "national average. Not surveillance; not a substitute for emergency services.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }],
    shortcut: ["/icons/icon-192.png"],
  },
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
      "Neighborhood-level safety awareness across 44 US cities. Drawn from official police open-data feeds.",
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
        {/* Google AdSense auto-ads loader. Conditional on the env var being set
            so non-production deploys don't request ads, AND consent-gated:
            ConsentedAdSense only injects the script after the user explicitly
            accepts (fix(audit ads-consent-gate)). strategy="afterInteractive"
            keeps Largest Contentful Paint clean. */}
        {ADSENSE_CLIENT_ID && <ConsentedAdSense clientId={ADSENSE_CLIENT_ID} />}
      </head>
      <body>
        {/* CityBackdrop sits at z:0 (its own stacking context via position:fixed).
            All page content is wrapped in `relative z-10` so it paints above the
            backdrop instead of underneath. The body is transparent so the
            backdrop is the actual paint at the bottom of the viewport. */}
        <CityBackdrop />
        <SessionBootstrap />
        <div className="relative z-10">{children}</div>
        {/* v92 — cookie consent banner only renders when AdSense is
            configured (the env var is set). Without AdSense the
            site drops no profiling cookies, so no banner is needed. */}
        {ADSENSE_CLIENT_ID && <CookieConsentBanner />}
        {/* v93p2 — COPPA age-gate interstitial (first-visit only). */}
        <AgeGate />
      </body>
    </html>
  );
}
