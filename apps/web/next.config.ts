import type { NextConfig } from "next";

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
};

export default config;
