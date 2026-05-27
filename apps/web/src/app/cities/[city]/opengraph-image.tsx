import { ImageResponse } from "next/og";
import { cityLabelBySlug } from "@/lib/city-labels";

// v95p28 — minimal repro to isolate the empty-body bug. Strips the
// styled card down to the barest ImageResponse so the next deploy
// either renders a plain card (proving the issue was in the prior
// styling/JSX) or still 0-bytes (proving the issue is the route
// shell itself). v95p27's try/catch never triggered, so the error
// is happening outside the handler — likely module init or
// ImageResponse setup with a value Satori can't render.
export const runtime = "edge";
export const revalidate = 3600;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "CommunitySafe city safety overview";

export default async function CityOgImage({ params }: { params: { city: string } }) {
  const label = cityLabelBySlug(params.city) ?? "City";
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          width: "100%",
          background: "#0E4F73",
          color: "white",
          fontSize: 80,
          fontFamily: "system-ui",
        }}
      >
        {label}
      </div>
    ),
    { ...size },
  );
}
