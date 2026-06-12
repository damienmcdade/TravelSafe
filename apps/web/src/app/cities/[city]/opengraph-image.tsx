import { ImageResponse } from "next/og";
import { cityLabelBySlug } from "@/lib/city-labels";
import { FBI_DATA_LABEL } from "@/lib/data-vintage";

/// Programmatic OG image for /cities/[city]. Renders at the edge per
/// request, then cached at Vercel's edge for `revalidate` seconds.
///
/// v95p29 — Satori (next/og's renderer) silently fails when any direct
/// child div doesn't carry `display: "flex"`. The pre-v95p27 version
/// had several text-only divs without explicit display, which produced
/// a 200 + image/png response with a 0-byte body and a truncated
/// "Error: Ex…" entry in Vercel runtime logs. The v95p28 minimal
/// repro (single flex div) proved out clean; this restores the rich
/// social card with `display: "flex"` on every container.
export const runtime = "edge";
export const revalidate = 3600;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "CommunitySafe city safety overview";

// fix(audit next15): params is a Promise in Next 15+ (the sync-access shim is
// removed in Next 16, where params.city would become undefined and every city
// OG card silently degrades to the generic fallback). Await it, like page.tsx.
export default async function CityOgImage({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params;
  const label = cityLabelBySlug(city) ?? "City";
  const source = `${label} police open-data feed`;
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          width: "100%",
          background: "linear-gradient(135deg,#0E4F73 0%,#2563EB 100%)",
          color: "white",
          padding: "70px 80px",
          fontFamily: "system-ui",
        }}
      >
        <div style={{ display: "flex", fontSize: 28, letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.85 }}>
          CommunitySafe · Safety overview
        </div>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" }}>
          <div style={{ display: "flex", fontSize: 96, fontWeight: 700, lineHeight: 1.05 }}>{label}</div>
          <div style={{ display: "flex", fontSize: 32, marginTop: 20, opacity: 0.9, maxWidth: 920 }}>
            Neighborhood-level safety data compared to the {FBI_DATA_LABEL} national average.
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
          <div style={{ display: "flex" }}>
            Source: {source.length > 60 ? source.slice(0, 57) + "…" : source}
          </div>
          <div style={{ display: "flex" }}>
            communitysafe.app/cities/{city}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
