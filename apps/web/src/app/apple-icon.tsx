import { ImageResponse } from "next/og";

/// iOS home-screen icon. Apple's PWA install pulls 180×180 specifically
/// and applies its own rounded-corner mask, so we paint a full-bleed
/// square. v96 — matches the detailed guardian-over-city app icon
/// used by the static PWA and native launcher assets.
export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const C = {
  skyTop: "#050B1C",
  skyMid: "#0A1A38",
  skyHorizon: "#1A2D55",
  cityFar: "#1E2A48",
  cityMid: "#0F1A33",
  cityNear: "#06101F",
  cityFg: "#020610",
  windowGold: "#FFD27F",
  windowCyan: "#88D7E8",
  angelWhite: "#FBF7E6",
  wingCyan: "#88D7E8",
  haloGold: "#FFD27F",
  haloDeep: "#C99841",
};

export default function AppleIcon() {
  const farBuildings: Array<[number, number, number, number]> = [
    [16, 348, 28, 90], [66, 330, 36, 108], [128, 320, 32, 118],
    [184, 326, 30, 112], [246, 318, 32, 120], [332, 318, 32, 120],
    [388, 322, 30, 116], [444, 332, 32, 106], [476, 350, 24, 88],
  ];
  const midBuildings: Array<[number, number, number, number]> = [
    [22, 312, 44, 168], [66, 296, 38, 184], [104, 268, 50, 212],
    [154, 256, 44, 224], [198, 240, 52, 240], [250, 224, 56, 256],
    [306, 240, 52, 240], [358, 256, 44, 224], [402, 268, 50, 212],
    [452, 296, 38, 184],
  ];
  const windows: Array<[number, number, string?]> = [
    [30, 330], [78, 315], [118, 288], [142, 336], [166, 280],
    [188, 330], [214, 262], [238, 314], [270, 244], [294, 326],
    [318, 260], [348, 318], [374, 280], [416, 292], [462, 320],
    [58, 390], [92, 372], [130, 404], [176, 386], [226, 374],
    [282, 374], [336, 386], [392, 404], [438, 372], [472, 390],
    [248, 352, C.windowCyan], [304, 350, C.windowCyan],
  ];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: C.skyTop }}>
        <svg width="100%" height="100%" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={C.skyTop} />
              <stop offset="0.55" stopColor={C.skyMid} />
              <stop offset="0.85" stopColor={C.skyHorizon} />
              <stop offset="1" stopColor={C.cityFg} />
            </linearGradient>
            <radialGradient id="aura" cx="0.5" cy="0.38" r="0.55">
              <stop offset="0" stopColor="#FFE7A8" stopOpacity="0.65" />
              <stop offset="0.45" stopColor="#FFE7A8" stopOpacity="0.18" />
              <stop offset="1" stopColor="#FFE7A8" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="beam" x1="0.5" y1="0" x2="0.5" y2="1">
              <stop offset="0" stopColor="#FFE9B0" stopOpacity="0.62" />
              <stop offset="0.75" stopColor="#FFE9B0" stopOpacity="0.16" />
              <stop offset="1" stopColor="#FFE9B0" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="wingL" x1="1" y1="0" x2="0" y2="0.5">
              <stop offset="0" stopColor={C.angelWhite} />
              <stop offset="0.65" stopColor="#E8F1F5" />
              <stop offset="1" stopColor={C.wingCyan} />
            </linearGradient>
            <linearGradient id="wingR" x1="0" y1="0" x2="1" y2="0.5">
              <stop offset="0" stopColor={C.angelWhite} />
              <stop offset="0.65" stopColor="#E8F1F5" />
              <stop offset="1" stopColor={C.wingCyan} />
            </linearGradient>
          </defs>
          <rect width="512" height="512" fill="url(#sky)" />
          <circle cx="406" cy="118" r="20" fill="#FFE9B0" opacity="0.9" />
          <circle cx="406" cy="118" r="58" fill="#FFE9B0" opacity="0.12" />
          <g fill="#F6F2D8" opacity="0.9">
            {[[56, 56, 1.4], [120, 92, 1], [168, 40, 1.6], [296, 48, 1.4], [400, 36, 1.2], [440, 80, 1], [148, 156, 1.2], [452, 116, 1.4]].map(([x, y, r], i) => (
              <circle key={i} cx={x} cy={y} r={r} />
            ))}
          </g>
          <polygon points="220,200 292,200 360,462 152,462" fill="url(#beam)" opacity="0.72" />
          <circle cx="256" cy="200" r="120" fill="url(#aura)" />
          <g fill={C.cityFar} opacity="0.94">
            {farBuildings.map(([x, y, w, h], i) => (
              <rect key={i} x={x} y={y} width={w} height={h} />
            ))}
          </g>
          <g fill={C.cityMid}>
            {midBuildings.map(([x, y, w, h], i) => (
              <rect key={i} x={x} y={y} width={w} height={h} />
            ))}
            <rect x="276" y="208" width="4" height="20" />
            <rect x="222" y="226" width="3" height="16" />
            <rect x="328" y="226" width="3" height="16" />
          </g>
          <g>
            {windows.map(([x, y, fill], i) => (
              <rect key={i} x={x} y={y} width="4" height="4" fill={fill ?? C.windowGold} />
            ))}
          </g>
          <rect x="0" y="468" width="512" height="44" fill={C.cityFg} opacity="0.9" />
          <path d="M256 196 Q170 158 92 198 Q138 202 198 218 Q158 220 124 246 Q188 240 226 246 Q198 250 178 270 Q224 256 256 256Z" fill="url(#wingL)" />
          <path d="M256 196 Q342 158 420 198 Q374 202 314 218 Q354 220 388 246 Q324 240 286 246 Q314 250 334 270 Q288 256 256 256Z" fill="url(#wingR)" />
          <path d="M256 200 Q200 188 152 196 Q198 200 222 212 Q198 214 178 226 Q226 220 252 224Z" fill={C.angelWhite} opacity="0.55" />
          <path d="M256 200 Q312 188 360 196 Q314 200 290 212 Q314 214 334 226 Q286 220 260 224Z" fill={C.angelWhite} opacity="0.55" />
          <circle cx="98" cy="200" r="6" fill={C.wingCyan} opacity="0.9" />
          <circle cx="414" cy="200" r="6" fill={C.wingCyan} opacity="0.9" />
          <path d="M232 196 L280 196 L300 286 L304 308 L208 308 L212 286Z" fill={C.angelWhite} />
          <path d="M232 196 L240 308M256 196 L256 308M280 196 L272 308" stroke="#8CB6CC" strokeWidth="1.5" opacity="0.4" fill="none" />
          <circle cx="256" cy="172" r="20" fill={C.angelWhite} />
          <ellipse cx="256" cy="142" rx="40" ry="11" fill="none" stroke={C.haloGold} strokeWidth="4" opacity="0.96" />
          <ellipse cx="256" cy="142" rx="46" ry="13" fill="none" stroke={C.haloGold} strokeWidth="2" opacity="0.55" />
          <ellipse cx="256" cy="142" rx="34" ry="9" fill="none" stroke={C.haloDeep} strokeWidth="1.5" opacity="0.75" />
          <ellipse cx="246" cy="138" rx="8" ry="2" fill={C.angelWhite} opacity="0.9" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
