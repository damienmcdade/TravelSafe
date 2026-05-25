// Minimal env reader for adapter-specific configuration. The package
// is consumed by both apps/web (Next.js / Vercel) and apps/api
// (Express / Railway), so we can't import either runtime's env
// module — we read process.env directly with safe defaults.
//
// Apps that set these env vars get the adapter behavior they
// configure; everyone else gets the documented defaults.

function read(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

function readOpt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : undefined;
}

export const env = {
  // San Diego — SANDAG Socrata jurisdiction-level fallback.
  SANDAG_SOCRATA_BASE:           read("SANDAG_SOCRATA_BASE", "https://data.sandiegocounty.gov"),
  SANDAG_CRIME_RATES_RESOURCE_ID: read("SANDAG_CRIME_RATES_RESOURCE_ID", "486f-q228"),
  SANDAG_SOCRATA_APP_TOKEN:      readOpt("SANDAG_SOCRATA_APP_TOKEN"),
  // San Diego — SDPD NIBRS CSV bulk download base.
  SDPD_NIBRS_CSV_BASE:           read("SDPD_NIBRS_CSV_BASE", "https://seshat.datasd.org/police_nibrs"),
  // Boston — Cloudflare Worker proxy URL that fronts data.boston.gov
  // (Vercel's IP range is blocked from the CKAN endpoint).
  BOSTON_PROXY_URL:              readOpt("BOSTON_PROXY_URL"),
  // Denver — internal-only ArcGIS token (not used in prod yet;
  // adapter file kept as reference).
  DENVER_ARCGIS_TOKEN:           readOpt("DENVER_ARCGIS_TOKEN"),
};
