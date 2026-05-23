import { ImageResponse } from "next/og";
import { cityBySlug } from "@/server/services/crime-data/cities";

/// Programmatic OG image for /cities/[city]/[neighborhood]. Renders the
/// neighborhood label, parent city, and the city's CITYWIDE Safety
/// grade as a social-card hero.
///
/// Why citywide grade (not per-area): the per-area grade requires
/// polygon-area weighting which imports node:fs via polygon-areas, and
/// the OG-image route's edge runtime can't resolve that. Citywide grade
/// is honest at OG scale — it's still a meaningful signal of the city's
/// overall safety profile, and we fetch it through our public API
/// rather than importing the service directly to keep the bundle tiny.
export const runtime = "edge";
export const revalidate = 3600;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "TravelSafe neighborhood safety overview";

/// Grade → background gradient + text accent. Matches the in-app palette
/// without alarming reds: even the worst grade reads "noteworthy" rather
/// than "emergency", which is the framing we want at OG scale.
const GRADE_THEME: Record<string, { bg: string; tile: string; word: string }> = {
  A: { bg: "linear-gradient(135deg,#3F7C47 0%,#7BA86E 100%)", tile: "#EAF4E6", word: "Lower than national" },
  B: { bg: "linear-gradient(135deg,#4B7B5A 0%,#9BB987 100%)", tile: "#EAF4E6", word: "Below national" },
  C: { bg: "linear-gradient(135deg,#0E4F73 0%,#2563EB 100%)", tile: "#F4F1EA", word: "Near national" },
  D: { bg: "linear-gradient(135deg,#8B6B2A 0%,#D4A046 100%)", tile: "#FDF6E6", word: "Above national" },
  E: { bg: "linear-gradient(135deg,#7A3A2C 0%,#C66B58 100%)", tile: "#FDEBE3", word: "Higher than national" },
};

/// Fetch the citywide grade via our public API. Edge-safe (just fetch),
/// reuses our existing compute + cache, and degrades to null on any
/// failure so the OG card falls back to a neutral neutral-blue card.
/// Absolute URL is derived from NEXT_PUBLIC_SITE_URL (set in env) with
/// VERCEL_URL as a backstop — same pattern as sitemap.ts.
async function fetchCityGrade(citySlug: string): Promise<keyof typeof GRADE_THEME | null> {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://travel-safe-chi.vercel.app");
  try {
    const res = await fetch(`${base}/api/safezone/safety-score?city=${citySlug}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data: { grade?: string } = await res.json();
    const g = data.grade;
    return g === "A" || g === "B" || g === "C" || g === "D" || g === "E" ? g : null;
  } catch {
    return null;
  }
}

export default async function NeighborhoodOgImage({
  params,
}: {
  params: { city: string; neighborhood: string };
}) {
  const city = cityBySlug(params.city);
  if (!city) return fallback("Neighborhood overview", "TravelSafe");

  // city.discover() reaches the adapter which may pull a remote feed —
  // but it's cached aggressively and necessary to resolve the label.
  // If discover throws (upstream outage), still render a fallback card.
  const areas = await city.discover().catch(() => []);
  const area = areas.find((a) => a.slug === params.neighborhood);
  if (!area) return fallback(`${city.label} neighborhood`, city.label);

  const grade = await fetchCityGrade(params.city);
  const theme = grade ? GRADE_THEME[grade] : GRADE_THEME.C;

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          background: theme.bg,
          color: "white",
          padding: "70px 80px",
          fontFamily: "system-ui",
        }}
      >
        {/* Left column: hero text + footer attribution. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            justifyContent: "space-between",
            marginRight: 40,
          }}
        >
          <div style={{ display: "flex", fontSize: 26, letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.85 }}>
            TravelSafe · {city.label}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 78, fontWeight: 700, lineHeight: 1.04, maxWidth: 720 }}>
              {area.label}
            </div>
            <div style={{ display: "flex", fontSize: 26, marginTop: 22, opacity: 0.92, maxWidth: 720, lineHeight: 1.3 }}>
              Neighborhood-level safety data compared to the FBI Crime in the Nation 2024 national average.
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 20, opacity: 0.85 }}>
            travel-safe-chi.vercel.app/cities/{params.city}/{params.neighborhood}
          </div>
        </div>
        {/* Right column: grade tile + caveat caption. The caveat is
            essential — grade reflects the CITY's score, not this area's,
            because the per-area grade requires server modules we can't
            load in the OG runtime. Calling it out keeps the OG card
            honest. */}
        {grade && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              width: 320,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 220,
                height: 220,
                borderRadius: 36,
                background: theme.tile,
                color: "#1f2937",
                fontSize: 160,
                fontWeight: 700,
                lineHeight: 1,
              }}
            >
              {grade}
            </div>
            <div style={{ display: "flex", marginTop: 18, fontSize: 22, opacity: 0.92, textAlign: "center" }}>
              {theme.word}
            </div>
            <div style={{ display: "flex", marginTop: 6, fontSize: 16, opacity: 0.7, textAlign: "center" }}>
              ({city.label} citywide)
            </div>
          </div>
        )}
      </div>
    ),
    { ...size },
  );
}

function fallback(line1: string, line2: string) {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          background: "linear-gradient(135deg,#0E4F73 0%,#2563EB 100%)",
          color: "white",
          fontFamily: "system-ui",
        }}
      >
        <div style={{ display: "flex", fontSize: 24, letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.85 }}>
          TravelSafe
        </div>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 700, marginTop: 12 }}>{line1}</div>
        <div style={{ display: "flex", fontSize: 30, marginTop: 14, opacity: 0.9 }}>{line2}</div>
      </div>
    ),
    { ...size },
  );
}
