import { ImageResponse } from "next/og";

/// Default OG image for every public surface that doesn't ship its
/// own opengraph-image.tsx. Per-city + per-neighborhood pages override
/// this with their own tailored variants; everything else (homepage,
/// /threats, /map, /coverage, /methodology, etc) inherits this brand
/// card so social shares of those URLs render a real image instead of
/// nothing.
export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "TravelSafe — neighborhood-level safety awareness across 30 US cities";

export default function RootOgImage() {
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
          padding: "80px 90px",
          fontFamily: "system-ui",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 28,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            opacity: 0.85,
          }}
        >
          TravelSafe
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            justifyContent: "center",
          }}
        >
          <div style={{ display: "flex", fontSize: 84, fontWeight: 700, lineHeight: 1.06, maxWidth: 1020 }}>
            Neighborhood-level safety awareness across 30 US cities.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              marginTop: 22,
              opacity: 0.92,
              maxWidth: 1020,
              lineHeight: 1.3,
            }}
          >
            Drawn from official police open-data feeds and the FBI Crime in the Nation 2023 national average.
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
          <span>Not surveillance. Not a substitute for emergency services.</span>
          <span>travel-safe-chi.vercel.app</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
