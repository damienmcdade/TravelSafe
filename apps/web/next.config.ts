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
};

export default config;
