import { ImageResponse } from "next/og";

/// Programmatic favicon — v95p43. Highly-detailed guardian angel
/// hovering over the downtown skyline of a massive city.
/// Single 512×512 PNG produced by Next/Satori from inline SVG;
/// Next downsamples for /icon, /apple-icon, /favicon, etc.
///
/// Detail sources (no external assets, all vector primitives Satori
/// supports — no filters, no masks):
///  - Multi-depth skyline: a hazy back row + a sharper mid row +
///    foreground silhouettes, each with their own colour value so the
///    eye reads depth.
///  - 200+ window lights placed irregularly across the buildings,
///    most lit gold, a few cyan for variety.
///  - Stars + a soft moon disc in the sky gradient.
///  - Guardian angel: layered wings of three feather rows + flowing
///    robe + multi-ring halo + a downward light beam toward the city
///    (the protective gesture).
export const runtime = "edge";
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

const C = {
  skyTop: "#050B1C",
  skyMid: "#0A1A38",
  skyHorizon: "#1A2D55",
  starWhite: "#F6F2D8",
  moonGlow: "#FFE9B0",

  cityFar: "#1E2A48",
  cityMid: "#0F1A33",
  cityNear: "#06101F",
  cityFg: "#020610",

  winGold: "#FFD27F",
  winDimGold: "#B6864A",
  winCyan: "#88D7E8",

  angelCore: "#FBF7E6",
  angelGlow: "#FFE7A8",
  wingMid: "#E8F1F5",
  wingDeep: "#8CB6CC",
  haloGold: "#FFD27F",
  haloDeep: "#C99841",
  beam: "#FFE9B0",
};

// Helpers — Satori doesn't support &nbsp;/comments inside <svg>, keep
// the markup straightforward.

// A column of irregular window lights for a building rectangle.
function windowGrid(
  x: number,
  y: number,
  w: number,
  h: number,
  density = 0.55,
  cyanRatio = 0.04,
) {
  const winSize = 4;
  const padX = 4;
  const padY = 6;
  const cols = Math.floor((w - padX * 2) / (winSize + 3));
  const rows = Math.floor((h - padY * 2) / (winSize + 4));
  const items: React.ReactElement[] = [];
  let seed = (x * 13 + y * 7 + w * 3 + h) | 0;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rand() > density) continue;
      const wx = x + padX + c * (winSize + 3);
      const wy = y + padY + r * (winSize + 4);
      const colour =
        rand() < cyanRatio
          ? C.winCyan
          : rand() < 0.25
            ? C.winDimGold
            : C.winGold;
      items.push(
        <rect
          key={`${wx}-${wy}`}
          x={wx}
          y={wy}
          width={winSize}
          height={winSize}
          fill={colour}
        />,
      );
    }
  }
  return items;
}

export default function Icon() {
  // Back-row buildings (hazier, smaller): occupy upper third of cityline
  const farBuildings: Array<[number, number, number, number]> = [
    [16, 348, 28, 90],
    [44, 360, 22, 78],
    [66, 330, 36, 108],
    [102, 350, 26, 88],
    [128, 320, 32, 118],
    [160, 340, 24, 98],
    [184, 326, 30, 112],
    [218, 344, 28, 94],
    [246, 318, 32, 120],
    [278, 332, 26, 106],
    [304, 346, 28, 92],
    [332, 318, 32, 120],
    [364, 336, 24, 102],
    [388, 322, 30, 116],
    [418, 348, 26, 90],
    [444, 332, 32, 106],
    [476, 350, 24, 88],
  ];

  // Mid-row buildings (sharper, taller, the iconic skyline)
  const midBuildings: Array<[number, number, number, number]> = [
    [22, 312, 44, 168],
    [66, 296, 38, 184],
    [104, 268, 50, 212],
    [154, 256, 44, 224],
    [198, 240, 52, 240],
    [250, 224, 56, 256],
    [306, 240, 52, 240],
    [358, 256, 44, 224],
    [402, 268, 50, 212],
    [452, 296, 38, 184],
  ];

  // Foreground silhouettes (no windows, deepest shade)
  const fgBuildings: Array<[number, number, number, number]> = [
    [10, 412, 60, 68],
    [70, 400, 50, 80],
    [120, 408, 48, 72],
    [168, 392, 56, 88],
    [224, 400, 52, 80],
    [276, 392, 60, 88],
    [336, 408, 48, 72],
    [384, 400, 50, 80],
    [434, 412, 68, 68],
  ];

  // Stars + a faint moon
  const stars: Array<[number, number, number]> = [
    [56, 56, 1.4],
    [120, 92, 1.0],
    [168, 40, 1.6],
    [216, 76, 1.0],
    [296, 48, 1.4],
    [336, 88, 1.0],
    [400, 36, 1.2],
    [440, 80, 1.0],
    [76, 138, 1.0],
    [148, 156, 1.2],
    [380, 144, 1.0],
    [452, 116, 1.4],
    [88, 220, 0.9],
    [424, 224, 0.9],
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: C.skyTop,
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 512 512"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={C.skyTop} />
              <stop offset="0.55" stopColor={C.skyMid} />
              <stop offset="0.85" stopColor={C.skyHorizon} />
              <stop offset="1" stopColor={C.cityFg} />
            </linearGradient>
            <radialGradient id="moon" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor={C.moonGlow} stopOpacity="0.95" />
              <stop offset="0.55" stopColor={C.moonGlow} stopOpacity="0.18" />
              <stop offset="1" stopColor={C.moonGlow} stopOpacity="0" />
            </radialGradient>
            <radialGradient id="angelaura" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor={C.angelGlow} stopOpacity="0.55" />
              <stop offset="0.45" stopColor={C.angelGlow} stopOpacity="0.2" />
              <stop offset="1" stopColor={C.angelGlow} stopOpacity="0" />
            </radialGradient>
            <linearGradient id="beam" x1="0.5" y1="0" x2="0.5" y2="1">
              <stop offset="0" stopColor={C.beam} stopOpacity="0.55" />
              <stop offset="0.7" stopColor={C.beam} stopOpacity="0.18" />
              <stop offset="1" stopColor={C.beam} stopOpacity="0" />
            </linearGradient>
            <linearGradient id="wing-l" x1="1" y1="0" x2="0" y2="0.5">
              <stop offset="0" stopColor={C.angelCore} />
              <stop offset="0.6" stopColor={C.wingMid} />
              <stop offset="1" stopColor={C.wingDeep} />
            </linearGradient>
            <linearGradient id="wing-r" x1="0" y1="0" x2="1" y2="0.5">
              <stop offset="0" stopColor={C.angelCore} />
              <stop offset="0.6" stopColor={C.wingMid} />
              <stop offset="1" stopColor={C.wingDeep} />
            </linearGradient>
          </defs>

          {/* Rounded-rect mask is fine for app-icon tile; <rect rx> is supported */}
          <rect width="512" height="512" rx="96" fill="url(#sky)" />

          {/* Moon — soft glow, off-centre upper right */}
          <circle cx="406" cy="118" r="32" fill={C.moonGlow} opacity="0.18" />
          <circle cx="406" cy="118" r="20" fill={C.moonGlow} opacity="0.9" />
          <circle cx="406" cy="118" r="60" fill="url(#moon)" />

          {/* Stars */}
          {stars.map(([x, y, r], i) => (
            <circle key={`s-${i}`} cx={x} cy={y} r={r} fill={C.starWhite} opacity="0.85" />
          ))}

          {/* Soft angel-down light beam over the city — fan from angel */}
          <polygon
            points="220,200 292,200 360,460 152,460"
            fill="url(#beam)"
            opacity="0.7"
          />

          {/* Angel aura (largest, behind everything else of the figure) */}
          <circle cx="256" cy="200" r="120" fill="url(#angelaura)" />

          {/* Back-row buildings (hazy) */}
          {farBuildings.map(([x, y, w, h], i) => (
            <rect key={`f-${i}`} x={x} y={y} width={w} height={h} fill={C.cityFar} />
          ))}
          {farBuildings.flatMap(([x, y, w, h]) =>
            windowGrid(x, y, w, h, 0.32, 0.03),
          )}

          {/* Mid-row buildings (sharp + windowy) */}
          {midBuildings.map(([x, y, w, h], i) => (
            <rect key={`m-${i}`} x={x} y={y} width={w} height={h} fill={C.cityMid} />
          ))}
          {/* Antennas/spires on the two tallest */}
          <rect x="276" y="208" width="4" height="20" fill={C.cityMid} />
          <rect x="222" y="226" width="3" height="16" fill={C.cityMid} />
          <rect x="328" y="226" width="3" height="16" fill={C.cityMid} />
          <circle cx="278" cy="208" r="3" fill={C.winGold} />
          {midBuildings.flatMap(([x, y, w, h]) =>
            windowGrid(x, y, w, h, 0.6, 0.05),
          )}

          {/* Near-row foreground silhouettes (no windows) */}
          {fgBuildings.map(([x, y, w, h], i) => (
            <rect key={`g-${i}`} x={x} y={y} width={w} height={h} fill={C.cityNear} />
          ))}

          {/* Ground line haze */}
          <rect x="0" y="468" width="512" height="44" fill={C.cityFg} opacity="0.85" />

          {/* ── GUARDIAN ANGEL ───────────────────────────────────── */}

          {/* Left wing — three feather layers */}
          <path
            d="M256 196
               Q 170 158 92 198
               Q 138 202 198 218
               Q 158 220 124 246
               Q 188 240 226 246
               Q 198 250 178 270
               Q 224 256 256 256 Z"
            fill="url(#wing-l)"
            opacity="0.97"
          />
          <path
            d="M256 200
               Q 200 188 152 196
               Q 198 200 222 212
               Q 198 214 178 226
               Q 226 220 252 224 Z"
            fill={C.angelCore}
            opacity="0.55"
          />

          {/* Right wing — mirror */}
          <path
            d="M256 196
               Q 342 158 420 198
               Q 374 202 314 218
               Q 354 220 388 246
               Q 324 240 286 246
               Q 314 250 334 270
               Q 288 256 256 256 Z"
            fill="url(#wing-r)"
            opacity="0.97"
          />
          <path
            d="M256 200
               Q 312 188 360 196
               Q 314 200 290 212
               Q 314 214 334 226
               Q 286 220 260 224 Z"
            fill={C.angelCore}
            opacity="0.55"
          />

          {/* Wing-tip glow accents */}
          <circle cx="98" cy="200" r="6" fill={C.winCyan} opacity="0.85" />
          <circle cx="414" cy="200" r="6" fill={C.winCyan} opacity="0.85" />

          {/* Robe — flowing trapezoid + folds */}
          <path
            d="M232 196
               L280 196
               L300 286
               L304 308
               L208 308
               L212 286 Z"
            fill={C.angelCore}
          />
          {/* Robe folds */}
          <path
            d="M232 196 L240 308" stroke={C.wingDeep} strokeWidth="1.5" opacity="0.4" fill="none"
          />
          <path
            d="M256 196 L256 308" stroke={C.wingDeep} strokeWidth="1.2" opacity="0.35" fill="none"
          />
          <path
            d="M280 196 L272 308" stroke={C.wingDeep} strokeWidth="1.5" opacity="0.4" fill="none"
          />

          {/* Sleeve hint (slight outward curve at shoulders) */}
          <path
            d="M232 196 Q 220 220 226 234 L 234 232 Q 232 218 240 200 Z"
            fill={C.angelCore}
            opacity="0.95"
          />
          <path
            d="M280 196 Q 292 220 286 234 L 278 232 Q 280 218 272 200 Z"
            fill={C.angelCore}
            opacity="0.95"
          />

          {/* Head */}
          <circle cx="256" cy="172" r="20" fill={C.angelCore} />
          {/* Subtle hair shadow */}
          <path
            d="M240 168 Q 256 158 272 168 Q 272 162 256 156 Q 240 162 240 168 Z"
            fill={C.wingDeep}
            opacity="0.18"
          />

          {/* Halo — three-ring with gold gradient feel */}
          <ellipse cx="256" cy="142" rx="40" ry="11" fill="none" stroke={C.haloGold} strokeWidth="4" opacity="0.95" />
          <ellipse cx="256" cy="142" rx="46" ry="13" fill="none" stroke={C.haloGold} strokeWidth="2" opacity="0.55" />
          <ellipse cx="256" cy="142" rx="34" ry="9" fill="none" stroke={C.haloDeep} strokeWidth="1.5" opacity="0.7" />

          {/* Two halo highlights to suggest 3-D */}
          <ellipse cx="246" cy="138" rx="8" ry="2" fill={C.angelCore} opacity="0.9" />
          <ellipse cx="270" cy="146" rx="6" ry="1.4" fill={C.angelCore} opacity="0.7" />

          {/* Outer angel rim-light */}
          <circle cx="256" cy="220" r="100" fill="none" stroke={C.angelGlow} strokeWidth="1" opacity="0.18" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
