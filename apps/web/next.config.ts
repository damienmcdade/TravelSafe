import type { NextConfig } from "next";

// Browser security headers applied to every route. Lifted out of the
// config object so the rationale stays close to the values.
//
// What's INCLUDED:
//   Strict-Transport-Security: 2-year max-age + includeSubDomains +
//     preload. Required by the Chromium HSTS preload list. Safe
//     because the site is always served over HTTPS via Vercel.
//   X-Content-Type-Options: nosniff. Stops the browser from
//     content-sniffing a response into an unexpected MIME type
//     (the classic XSS path on image upload endpoints).
//   X-Frame-Options: DENY. Defeats clickjacking — nothing embeds
//     TravelSafe in an iframe, including ourselves.
//   Referrer-Policy: strict-origin-when-cross-origin. Modern
//     default — sends only the origin to third parties, full URL
//     to same-origin.
//   Permissions-Policy: geolocation=(self) — the route planner +
//     map use it. Everything else (camera, mic, payment, USB,
//     FLoC/Topics) explicitly denied.
//   Cross-Origin-Opener-Policy: same-origin. Isolates this window
//     from any cross-origin popup so leaks via window.opener are
//     blocked.
//   X-DNS-Prefetch-Control: on. Lets the browser warm DNS for
//     external assets (Wikimedia CDN, OSM tile servers) before the
//     user clicks through to the map / city page.
//
// What's NOT included yet:
//   Content-Security-Policy — needs dedicated testing across the
//     map (Leaflet inline styles), OSRM (route planner), AI SDK
//     streaming, Wikimedia images, and every open-data domain.
//     A misconfigured CSP would silently break the map without
//     surfacing in dev. Tracked separately.
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options",    value: "nosniff" },
  { key: "X-Frame-Options",           value: "DENY" },
  { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy",        value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control",    value: "on" },
];

const config: NextConfig = {
  reactStrictMode: true,
  // Force-include the bundled Boston snapshot in the serverless function
  // bundle. Next's file-tracing has missed the JSON import in two locations,
  // so we make it explicit here.
  outputFileTracingIncludes: {
    "/api/crime-data/**": ["./src/server/data/**"],
    "/api/geo/**":        ["./src/server/data/**"],
  },
  // Allow next/image to optimize Wikimedia photos used by CityBackdrop.
  // Optimization gives us AVIF/WebP conversion + responsive srcsets +
  // proper lazy-load — meaningful LCP + bandwidth win since each city
  // ships ~4 photos at 1920px width.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "upload.wikimedia.org", pathname: "/wikipedia/commons/**" },
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
    ];
  },
};

export default config;
