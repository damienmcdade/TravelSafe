import { NextResponse } from "next/server";

// Universal Links association file for the CommunitySafe iOS app.
// iOS fetches https://communitysafe.app/.well-known/apple-app-site-association
// (no redirect allowed, Content-Type application/json) to verify the
// applinks:communitysafe.app Associated Domains entitlement in the iOS shell
// (apps/web/ios/App). A route handler (rather than a public/ file) guarantees
// the JSON content type — Vercel serves extensionless static files as
// octet-stream. `force-static` keeps this compatible with the MOBILE_BUILD
// static-export path too.
const AASA = {
  applinks: {
    details: [
      {
        appIDs: ["2S2MY5X9B9.app.communitysafe"],
        components: [{ "/": "/*" }],
      },
    ],
  },
};

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(AASA, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
