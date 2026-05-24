import { ImageResponse } from "next/og";
import { cityBySlug } from "@/server/services/crime-data/cities";

/// Programmatic OG image for /cities/[city]. Renders at edge per request,
/// then cached at Vercel's edge for `revalidate` seconds. Each share of a
/// city URL gets a tailored social card rather than the generic site
/// fallback.
export const runtime = "edge";
export const revalidate = 3600;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "TravelSafe city safety overview";

export default async function CityOgImage({ params }: { params: { city: string } }) {
  const city = cityBySlug(params.city);
  const label = city?.label ?? "City";
  // CityEntry on the server doesn't carry a `source` string (that lives
  // on the client-side CITIES catalog in lib/use-city.ts). The line just
  // labels the dataset on the social card — a generic fallback reads
  // fine when we don't have a richer label handy.
  const source = `${label} police open-data feed`;
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #0E4F73 0%, #2563EB 100%)",
          color: "white",
          padding: "70px 80px",
          fontFamily: "system-ui",
        }}
      >
        <div style={{ fontSize: 28, letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.85 }}>
          TravelSafe · Safety overview
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
          <div style={{ fontSize: 96, fontWeight: 700, lineHeight: 1.05 }}>{label}</div>
          <div style={{ fontSize: 32, marginTop: 20, opacity: 0.9, maxWidth: 920 }}>
            Neighborhood-level safety data compared to the FBI Crime in the Nation 2023 national average.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 22,
            opacity: 0.85,
            borderTop: "1px solid rgba(255,255,255,0.22)",
            paddingTop: 22,
          }}
        >
          <span>Source: {source.length > 60 ? source.slice(0, 57) + "…" : source}</span>
          <span>travel-safe-chi.vercel.app/cities/{params.city}</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
