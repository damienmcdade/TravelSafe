import { ImageResponse } from "next/og";

/// iOS home-screen icon. Apple's PWA install pulls 180×180 specifically
/// and applies its own rounded-corner mask, so we paint a full-bleed
/// square — iOS does the rest. v65 — angel-above-city design,
/// matches /icon. Theme color matches the manifest so the app's
/// standalone status bar reads as one continuous brand surface.
export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const C = {
  nightDeep: "#0A1628",
  nightMid: "#122440",
  citySilh: "#1A2640",
  windowGold: "#FFD27F",
  angelWhite: "#FFFFFF",
  wingCyan: "#88D7E8",
  haloGold: "#FFD27F",
};

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: C.nightDeep }}>
        <svg width="100%" height="100%" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={C.nightMid} />
              <stop offset="1" stopColor={C.nightDeep} />
            </linearGradient>
          </defs>
          <rect width="512" height="512" fill="url(#bg)" />
          <g fill={C.citySilh}>
            <rect x="32" y="360" width="56" height="120" />
            <rect x="88" y="320" width="48" height="160" />
            <rect x="136" y="290" width="64" height="190" />
            <rect x="200" y="270" width="56" height="210" />
            <rect x="256" y="270" width="56" height="210" />
            <rect x="312" y="290" width="64" height="190" />
            <rect x="376" y="320" width="48" height="160" />
            <rect x="424" y="360" width="56" height="120" />
          </g>
          <g fill={C.windowGold}>
            <rect x="100" y="340" width="6" height="6" />
            <rect x="220" y="370" width="6" height="6" />
            <rect x="276" y="370" width="6" height="6" />
            <rect x="388" y="340" width="6" height="6" />
          </g>
          <g fill={C.angelWhite} opacity="0.95">
            <path d="M256 200 Q 130 170 100 250 Q 150 220 220 240 Q 230 220 256 220 Z" />
            <path d="M256 200 Q 382 170 412 250 Q 362 220 292 240 Q 282 220 256 220 Z" />
          </g>
          <g fill={C.wingCyan} opacity="0.65">
            <circle cx="100" cy="248" r="14" />
            <circle cx="412" cy="248" r="14" />
          </g>
          <circle cx="256" cy="150" r="28" fill="none" stroke={C.haloGold} strokeWidth="6" opacity="0.85" />
          <circle cx="256" cy="170" r="22" fill={C.angelWhite} />
          <path d="M232 192 L280 192 L296 280 L216 280 Z" fill={C.angelWhite} />
        </svg>
      </div>
    ),
    { ...size },
  );
}
